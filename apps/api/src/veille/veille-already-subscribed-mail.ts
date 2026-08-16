import { VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import type { ComposeMailInput } from 'src/mail/mail-message';
import type { ChosenCommune } from './veille-confirmation-mail';

/** The "vous êtes déjà inscrit·e" mail: fr.mail.veille.alreadySubscribed
 * supplies the strings, the caller supplies the communes of the subscription
 * that already exists. No confirmation link (there is nothing left to
 * confirm) and no second unsubscribe link in the body — the skeleton's
 * footer already carries one. */
export const alreadySubscribedMailFor = (
  to: string,
  communes: readonly ChosenCommune[],
  unsubscribeToken: string,
): ComposeMailInput => ({
  to,
  subject: fr.mail.veille.alreadySubscribed.subject,
  reason: fr.mail.veille.reason,
  unsubscribePath: `${VEILLE_UNSUBSCRIBE_PATH}?token=${unsubscribeToken}`,
  blocks: [
    { kind: 'paragraph', text: fr.mail.veille.alreadySubscribed.intro },
    {
      kind: 'list',
      items: communes.map((c) => `${c.name} (${c.departementName})`),
    },
  ],
});
