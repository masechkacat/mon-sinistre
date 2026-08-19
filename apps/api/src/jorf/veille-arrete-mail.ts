import type { IsoDate } from '@mon-sinistre/contracts';
import { resolveDeadline } from 'src/deadline-rules/resolve-deadline';
import type {
  ArreteEntryOutcome,
  DurationUnit,
} from 'src/generated/prisma/enums';
import { fr } from 'src/i18n/fr';
import type { ComposeMailInput, MailBlock } from 'src/mail/mail-message';
import {
  communeLabel,
  unsubscribePathFor,
  type ChosenCommune,
} from 'src/veille/veille-confirmation-mail';
import { formatFrenchDate } from './french-date';

export interface ArreteEntryForMail {
  readonly commune: ChosenCommune;
  readonly risque: string;
  readonly eventStart: IsoDate;
  readonly eventEnd: IsoDate;
  readonly outcome: ArreteEntryOutcome;
}

export interface ArreteForMail {
  readonly publishedAt: IsoDate;
  readonly legifranceUrl: string;
}

/** Just enough of the active `DECLARATION_ASSUREUR` `DeadlineRule` to resolve
 * a deadline — the caller looks the row up, this file never queries the
 * database (docs/research/jorf-monitor.md, "DeadlineRule: срок déclaration"). */
export interface DeclarationDeadlineRule {
  readonly duration: number;
  readonly unit: DurationUnit;
}

/**
 * One recipient's mail for one arrêté (docs/research/jorf-monitor.md,
 * "Рассылка: outbox на VeilleNotification") — every commune of `entries`
 * belongs to the same recipient and the same arrêté, grouped upstream by
 * `resolveRecipients`. The declaration deadline is resolved from
 * `declarationRule` against `arrete.publishedAt` once for the whole message,
 * not per entry: the anchor is the same arrêté for all of them
 * (`DATE_PUBLICATION_ARRETE`). It is shown only if at least one entry is
 * `RECONNU` — a refusé-only message must not carry a deadline that does not
 * apply to it (PRD, critère "письмо для refusé... не показывает срок").
 */
export const veilleArreteMailFor = (
  to: string,
  unsubscribeToken: string,
  arrete: ArreteForMail,
  entries: readonly ArreteEntryForMail[],
  declarationRule: DeclarationDeadlineRule,
): ComposeMailInput => {
  const strings = fr.mail.jorf.notification;
  const hasReconnu = entries.some((entry) => entry.outcome === 'RECONNU');

  const blocks: MailBlock[] = [
    {
      kind: 'paragraph',
      text: strings.intro(formatFrenchDate(arrete.publishedAt)),
    },
    {
      kind: 'list',
      items: entries.map((entry) =>
        strings.entryLine(
          communeLabel(entry.commune),
          entry.risque,
          formatFrenchDate(entry.eventStart),
          formatFrenchDate(entry.eventEnd),
          strings.outcomeLabel[entry.outcome],
        ),
      ),
    },
  ];

  if (hasReconnu) {
    const deadline = resolveDeadline(
      arrete.publishedAt,
      declarationRule.duration,
      declarationRule.unit,
    );
    blocks.push({
      kind: 'paragraph',
      text: strings.deadline(formatFrenchDate(deadline)),
    });
  }

  blocks.push({
    kind: 'externalLink',
    text: strings.legifranceLink,
    url: arrete.legifranceUrl,
  });

  return {
    to,
    subject: strings.subject,
    reason: strings.reason,
    unsubscribePath: unsubscribePathFor(unsubscribeToken),
    blocks,
  };
};
