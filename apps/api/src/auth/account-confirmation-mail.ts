import {
  ACCOUNT_CONFIRM_PATH,
  ACCOUNT_CONFIRM_TTL_DAYS,
  ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import type { ComposeMailInput } from 'src/mail/mail-message';

/** The one account mail this issue sends; password reset and "already have an
 * account" follow the same shape in docs/plan/user-account.md phase 3. */
export const confirmationMailFor = (
  to: string,
  confirmToken: string,
): ComposeMailInput => ({
  to,
  subject: fr.mail.account.confirmation.subject,
  reason: fr.mail.account.reason,
  unsubscribePath: ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
  blocks: [
    { kind: 'paragraph', text: fr.mail.account.confirmation.intro },
    {
      kind: 'link',
      text: fr.mail.account.confirmation.confirmLink,
      path: `${ACCOUNT_CONFIRM_PATH}?token=${confirmToken}`,
    },
    {
      kind: 'paragraph',
      text: fr.mail.account.confirmation.expiresIn(
        String(ACCOUNT_CONFIRM_TTL_DAYS),
      ),
    },
  ],
});
