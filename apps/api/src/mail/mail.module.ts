import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FileMailTransport } from 'src/mail/file-mail.transport';
import { MailComposer } from 'src/mail/mail-composer';
import {
  SENDING_TRANSPORT,
  type MailTransportName,
} from 'src/mail/mail-transport-name';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';
import { MailService } from 'src/mail/mail.service';
import { ScalewayMailTransport } from 'src/mail/scaleway-mail.transport';

/**
 * The one place that decides how a message leaves, read once at startup.
 *
 * Anything but the sending transport is the local one — an unknown name cannot
 * arrive here, because the schema of the environment accepts only the two
 * (src/config/env.validation.ts), and an unset variable must mean local: a
 * fresh clone develops against an API that needs no provider account. The
 * opposite mistake — a production that quietly writes its notifications to
 * files — is refused by that same schema, not by this factory, which has no way
 * of telling a production from a laptop.
 */
const transportFor = (config: ConfigService): MailTransport => {
  if (config.get<MailTransportName>('MAIL_TRANSPORT') !== SENDING_TRANSPORT) {
    // Where the outbox goes is the transport's own default when the variable is
    // unset: two spellings of ".mail-outbox" would be one of them missing from
    // .gitignore, and those files carry real addresses.
    return new FileMailTransport(config.get<string>('MAIL_OUTBOX_DIR'));
  }

  return new ScalewayMailTransport({
    // An empty credential is refused by the schema (@IsNotEmpty under
    // @ValidateIf), which is where that guarantee lives: getOrThrow only
    // objects to a key that is absent, an empty string passes it. It is here
    // as the second line — a key the schema never saw stops the bootstrap
    // instead of building an application that starts healthy and has every
    // message refused by the provider. What it reports is the name of the key,
    // never its value.
    secretKey: config.getOrThrow<string>('SCW_SECRET_KEY'),
    projectId: config.getOrThrow<string>('SCW_PROJECT_ID'),
  });
};

/**
 * Global, like PrismaModule: sending mail is a cross-cutting dependency of the
 * product — veille, the JO monitor and the reminders all need it — not a
 * feature of its own.
 *
 * Only MailService is exported. Composing a message without going through the
 * single sending point is not something features are offered: the limits and
 * the logging of an email live there.
 */
@Global()
@Module({
  providers: [
    MailComposer,
    MailService,
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      // MailService never reads the environment: it is handed a transport, and
      // the tests of the module put their own behind this token
      // (docs/research/emails.md).
      useFactory: transportFor,
    },
  ],
  exports: [MailService],
})
export class MailModule {}
