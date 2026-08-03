import { Global, Module } from '@nestjs/common';

import { FileMailTransport } from 'src/mail/file-mail.transport';
import { MailComposer } from 'src/mail/mail-composer';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';
import { MailService } from 'src/mail/mail.service';

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
      // The only place that decides which transport is used; MailService never
      // reads the environment. Local development is the default and needs no
      // account and no key: a message is written to the outbox instead of
      // being sent. Choosing by MAIL_TRANSPORT arrives with the provider of
      // phase 2 (docs/research/emails.md).
      useFactory: (): MailTransport => new FileMailTransport(),
    },
  ],
  exports: [MailService],
})
export class MailModule {}
