import {
  ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
  SINISTRE_PATH,
} from '@mon-sinistre/contracts';
import { resolveDeadline } from 'src/deadline-rules/resolve-deadline';
import { fr } from 'src/i18n/fr';
import type { ComposeMailInput, MailBlock } from 'src/mail/mail-message';
import {
  communeLabel,
  type ChosenCommune,
} from 'src/veille/veille-confirmation-mail';
import { formatFrenchDate } from '../parse/french-date';
import type {
  ArreteForMail,
  DeclarationDeadlineRule,
} from './veille-arrete-mail';

/**
 * The letter a sinistre's owner gets once its commune's état de catastrophe
 * naturelle is recognised — one recipient, one commune, one arrêté
 * (docs/research/sinistre-plan.md, "Письмо владельцу синистра и
 * дедупликация с veille"); the caller never batches several owners into one
 * call the way `veilleArreteMailFor` batches several communes for one
 * observer. `unsubscribePath` is `ACCOUNT_MAIL_UNSUBSCRIBE_PATH`, not the
 * veille one: this letter is transactional to the sinistre, not a
 * subscription with its own rotating token.
 */
export const sinistreArreteMailFor = (
  to: string,
  commune: ChosenCommune,
  risque: string,
  arrete: ArreteForMail,
  declarationRule: DeclarationDeadlineRule,
): ComposeMailInput => {
  const strings = fr.mail.jorf.sinistreNotification;
  const notification = fr.mail.jorf.notification;
  const deadline = resolveDeadline(
    arrete.publishedAt,
    declarationRule.duration,
    declarationRule.unit,
  );

  const blocks: MailBlock[] = [
    {
      kind: 'paragraph',
      text: strings.intro(
        communeLabel(commune),
        risque,
        formatFrenchDate(arrete.publishedAt),
      ),
    },
    {
      kind: 'paragraph',
      text: notification.deadline(formatFrenchDate(deadline)),
    },
    {
      kind: 'link',
      text: strings.sinistreLink,
      path: SINISTRE_PATH,
    },
    {
      kind: 'externalLink',
      text: notification.legifranceLink,
      url: arrete.legifranceUrl,
    },
  ];

  return {
    to,
    subject: strings.subject,
    reason: strings.reason,
    unsubscribePath: ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
    blocks,
  };
};
