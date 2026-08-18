import { VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import type { MonitorAlertKind } from 'src/generated/prisma/enums';
import { fr } from 'src/i18n/fr';
import type { ComposeMailInput } from 'src/mail/mail-message';

export interface MonitorAlertForMail {
  readonly kind: MonitorAlertKind;
  readonly detail: string;
}

/**
 * unsubscribePath has no token to key off: this alert is not a subscription —
 * turning it off is an edit of ADMIN_EMAIL, not a web action — but every
 * message of the product still carries the field (mail/CLAUDE.md). Reusing
 * the veille route without a token keeps the link on-site and inert: a click
 * resolves to "lien invalide", never a broken host or a false claim of
 * success.
 */
export const monitorAlertMailFor = (
  to: string,
  alert: MonitorAlertForMail,
): ComposeMailInput => ({
  to,
  subject: fr.mail.jorf.alert.subject,
  reason: fr.mail.jorf.alert.reason,
  unsubscribePath: VEILLE_UNSUBSCRIBE_PATH,
  blocks: [
    { kind: 'paragraph', text: fr.mail.jorf.alert.intro },
    { kind: 'paragraph', text: fr.mail.jorf.alert.kindLabel[alert.kind] },
    { kind: 'paragraph', text: alert.detail },
  ],
});
