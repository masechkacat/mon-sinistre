import {
  ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
  ACCOUNT_RESET_PATH,
  PASSWORD_RESET_TTL_HOURS,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import type { ComposeMailInput } from 'src/mail/mail-message';

/** `fr.mail.account.reason` is shared with `confirmationMailFor` — every
 * account mail is justified by the same fact (`ACCOUNT_MAIL_UNSUBSCRIBE_PATH`
 * doc comment, `@mon-sinistre/contracts`), so this does not carry a second
 * "reason" string. */
export const passwordResetMailFor = (
  to: string,
  resetToken: string,
): ComposeMailInput => ({
  to,
  subject: fr.mail.account.passwordReset.subject,
  reason: fr.mail.account.reason,
  unsubscribePath: ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
  blocks: [
    { kind: 'paragraph', text: fr.mail.account.passwordReset.intro },
    {
      kind: 'link',
      text: fr.mail.account.passwordReset.resetLink,
      path: `${ACCOUNT_RESET_PATH}?token=${resetToken}`,
    },
    {
      kind: 'paragraph',
      text: fr.mail.account.passwordReset.expiresIn(
        String(PASSWORD_RESET_TTL_HOURS),
      ),
    },
  ],
});
