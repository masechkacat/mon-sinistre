import {
  ACCOUNT_FORGOT_PASSWORD_PATH,
  ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import type { ComposeMailInput } from 'src/mail/mail-message';

/** The one build of the "already have an account" mail — sent when
 * `AuthService.register` (`src/auth/CLAUDE.md`) is asked to register an
 * address that already has a confirmed account. The link's path is
 * `ACCOUNT_FORGOT_PASSWORD_PATH` — why that one and not `ACCOUNT_RESET_PATH`
 * is its own doc comment (`@mon-sinistre/contracts`), not repeated here.
 * `fr.mail.account.reason` is shared with the other two account mails —
 * `confirmationMailFor`'s doc comment. */
export const alreadyRegisteredMailFor = (to: string): ComposeMailInput => ({
  to,
  subject: fr.mail.account.alreadyRegistered.subject,
  reason: fr.mail.account.reason,
  unsubscribePath: ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
  blocks: [
    { kind: 'paragraph', text: fr.mail.account.alreadyRegistered.intro },
    {
      kind: 'link',
      text: fr.mail.account.alreadyRegistered.resetRequestLink,
      path: ACCOUNT_FORGOT_PASSWORD_PATH,
    },
  ],
});
