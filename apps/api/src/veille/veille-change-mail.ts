import {
  VEILLE_CHANGE_PATH,
  VEILLE_CHANGE_TTL_DAYS,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import type { ComposeMailInput } from 'src/mail/mail-message';
import {
  communeLabel,
  unsubscribePathFor,
  type ChosenCommune,
} from './veille-confirmation-mail';

/** The change-of-composition mail: fr.mail.veille.change supplies the
 * strings, the caller supplies the data (tokens, new communes) that is not
 * UI text. The list carries the **new** composition of the `VeilleChange`
 * request, not the subscription's current one — the reader confirms what
 * they are about to get, not what they already have. */
export const changeMailFor = (
  to: string,
  communes: readonly ChosenCommune[],
  changeToken: string,
  unsubscribeToken: string,
): ComposeMailInput => ({
  to,
  subject: fr.mail.veille.change.subject,
  reason: fr.mail.veille.reason,
  unsubscribePath: unsubscribePathFor(unsubscribeToken),
  blocks: [
    { kind: 'paragraph', text: fr.mail.veille.change.intro },
    {
      kind: 'list',
      items: communes.map(communeLabel),
    },
    {
      kind: 'link',
      text: fr.mail.veille.change.changeLink,
      path: `${VEILLE_CHANGE_PATH}?token=${changeToken}`,
    },
    {
      kind: 'paragraph',
      text: fr.mail.veille.change.expiresIn(String(VEILLE_CHANGE_TTL_DAYS)),
    },
  ],
});
