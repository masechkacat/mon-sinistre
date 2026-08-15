import {
  VEILLE_CONFIRM_PATH,
  VEILLE_CONFIRM_TTL_DAYS,
  VEILLE_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import type { ComposeMailInput } from 'src/mail/mail-message';

export interface ChosenCommune {
  readonly name: string;
  readonly departementName: string;
}

/** The confirmation mail of the veille: fr.mail.veille supplies the strings,
 * the caller supplies the data (tokens, chosen communes) that is not UI text. */
export const confirmationMailFor = (
  to: string,
  communes: readonly ChosenCommune[],
  confirmToken: string,
  unsubscribeToken: string,
): ComposeMailInput => ({
  to,
  subject: fr.mail.veille.confirmation.subject,
  reason: fr.mail.veille.reason,
  unsubscribePath: `${VEILLE_UNSUBSCRIBE_PATH}?token=${unsubscribeToken}`,
  blocks: [
    { kind: 'paragraph', text: fr.mail.veille.confirmation.intro },
    {
      kind: 'list',
      items: communes.map((c) => `${c.name} (${c.departementName})`),
    },
    {
      kind: 'link',
      text: fr.mail.veille.confirmation.confirmLink,
      path: `${VEILLE_CONFIRM_PATH}?token=${confirmToken}`,
    },
    {
      kind: 'paragraph',
      text: fr.mail.veille.confirmation.expiresIn(
        String(VEILLE_CONFIRM_TTL_DAYS),
      ),
    },
  ],
});
