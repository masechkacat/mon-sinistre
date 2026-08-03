import { Global, Module } from '@nestjs/common';

import { MailComposer } from 'src/mail/mail-composer';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';
import { MailService } from 'src/mail/mail.service';
import { UnconfiguredMailTransport } from 'src/mail/unconfigured-mail.transport';

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
      // reads the environment. Choosing by MAIL_TRANSPORT arrives with the
      // provider (phase 2) and the local transport with the next task of this
      // phase — until then a message fails loudly rather than disappearing.
      useFactory: (): MailTransport => new UnconfiguredMailTransport(),
    },
  ],
  exports: [MailService],
})
export class MailModule {}
