import { VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import type { MonitorAlertKind } from 'src/generated/prisma/enums';
import { fr } from 'src/i18n/fr';
import type { ComposeMailInput, MailBlock } from 'src/mail/mail-message';

export interface MonitorAlertForMail {
  readonly kind: MonitorAlertKind;
  readonly detail: string;
}

/**
 * How many alerts one message spells out. The rest are counted, not listed: a
 * referential that resolves none of an arrêté's ~720 communes would otherwise
 * make a message nobody can read out of a table anybody can query.
 */
export const MAX_ALERTS_DETAILED = 20;

/**
 * One message for everything a single arrêté raised, grouped by kind — a
 * message per alert row would mean hundreds of them for one publication, and
 * the provider would start refusing them halfway through.
 *
 * unsubscribePath has no token to key off: this alert is not a subscription —
 * turning it off is an edit of ADMIN_EMAIL, not a web action — but every
 * message of the product still carries the field (mail/CLAUDE.md). Reusing
 * the veille route without a token keeps the link on-site and inert: a click
 * resolves to "lien invalide", never a broken host or a false claim of
 * success.
 */
export const monitorAlertMailFor = (
  to: string,
  alerts: readonly MonitorAlertForMail[],
): ComposeMailInput => {
  const detailed = alerts.slice(0, MAX_ALERTS_DETAILED);
  const blocks: MailBlock[] = [
    {
      kind: 'paragraph',
      text: fr.mail.jorf.alert.intro(String(alerts.length)),
    },
  ];
  for (const kind of new Set(detailed.map((alert) => alert.kind))) {
    blocks.push(
      { kind: 'paragraph', text: fr.mail.jorf.alert.kindLabel[kind] },
      {
        kind: 'list',
        items: detailed
          .filter((alert) => alert.kind === kind)
          .map((alert) => alert.detail),
      },
    );
  }
  if (alerts.length > detailed.length) {
    blocks.push({
      kind: 'paragraph',
      text: fr.mail.jorf.alert.more(String(alerts.length - detailed.length)),
    });
  }

  return {
    to,
    subject: fr.mail.jorf.alert.subject,
    reason: fr.mail.jorf.alert.reason,
    unsubscribePath: VEILLE_UNSUBSCRIBE_PATH,
    blocks,
  };
};
