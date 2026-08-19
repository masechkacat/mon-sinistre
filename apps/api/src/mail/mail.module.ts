import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from 'src/config/env.validation';
import { FileMailTransport } from 'src/mail/file-mail.transport';
import { MailComposer, type MailComposerOptions } from 'src/mail/mail-composer';
import { SENDING_TRANSPORT } from 'src/mail/mail-transport-name';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';
import { MailService } from 'src/mail/mail.service';
import { ScalewayMailTransport } from 'src/mail/scaleway-mail.transport';

/** Exported for `apps/api/scripts/jorf-backfill.ts` (образец seed): the only caller outside this module building a `MailService` without Nest DI — the two belong here and not next to it, so the factory a bootstrapped app uses and the one the backfill script uses never drift apart. */
export const composerOptionsFrom = (
  config: ConfigService<EnvironmentVariables, true>,
): MailComposerOptions => ({
  baseUrl: config.get('FRONTEND_URL', { infer: true }),
  senderEmail: config.get('MAIL_FROM', { infer: true }),
});

/** Reading the environment happens here and nowhere else in the module. */
export const transportFor = (
  config: ConfigService<EnvironmentVariables, true>,
): MailTransport => {
  if (config.get('MAIL_TRANSPORT', { infer: true }) !== SENDING_TRANSPORT) {
    return new FileMailTransport(
      config.get('MAIL_OUTBOX_DIR', { infer: true }),
    );
  }

  return new ScalewayMailTransport({
    // getOrThrow, not get: these two are optional in the schema (@ValidateIf on
    // the sending transport), so the type is string | undefined. An empty value
    // is refused by the schema, but a key it never saw must stop the bootstrap
    // rather than start an application whose every message the provider refuses.
    secretKey: config.getOrThrow('SCW_SECRET_KEY', { infer: true }),
    projectId: config.getOrThrow('SCW_PROJECT_ID', { infer: true }),
  });
};

/** Global like PrismaModule; only MailService is exported. */
@Global()
@Module({
  providers: [
    {
      provide: MailComposer,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new MailComposer(composerOptionsFrom(config)),
    },
    MailService,
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: transportFor,
    },
  ],
  exports: [MailService],
})
export class MailModule {}
