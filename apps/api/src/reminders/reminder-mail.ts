import {
  REFERENCE_DATA_STALE_AFTER_MONTHS,
  REMINDER_UNSUBSCRIBE_PATH,
  SINISTRE_PATH,
  type IsoDate,
} from '@mon-sinistre/contracts';
import { toSourceReference } from 'src/common/source-reference';
import {
  isDeclarationRule,
  isInsurerRule,
} from 'src/deadline-rules/deadline-rule.seed';
import { fr } from 'src/i18n/fr';
import { formatFrenchDate } from 'src/jorf/parse/french-date';
import type { ComposeMailInput, MailBlock } from 'src/mail/mail-message';
import {
  communeLabel,
  type ChosenCommune,
} from 'src/veille/veille-confirmation-mail';

/** One step worth a line today. `remainingDays` is the count `selectReminders`
 * already made (`ReminderReason.offsetDays`), not a second arithmetic over
 * `plannedDate`; `source` is the step's own reference snapshot, resolved into a
 * `SourceReference` here against today. */
export interface ReminderStepForMail {
  readonly name: string;
  readonly plannedDate: IsoDate;
  readonly remainingDays: number;
  /** `DeadlineRule.code` of the step, null when it carries no rule. */
  readonly deadlineRuleCode: string | null;
  readonly source: {
    readonly url: string;
    readonly verifiedAt: IsoDate;
  } | null;
}

export interface ReminderSinistreForMail {
  readonly id: string;
  readonly commune: ChosenCommune;
  readonly risque: string;
  readonly eventDate: IsoDate;
  readonly steps: readonly ReminderStepForMail[];
}

export const reminderUnsubscribePathFor = (unsubscribeToken: string): string =>
  `${REMINDER_UNSUBSCRIBE_PATH}?token=${unsubscribeToken}`;

/**
 * The daily reminder of one person (docs/research/sinistre-reminders.md,
 * "Письмо"). The caller groups the reasons by recipient and hands over the
 * token it has just rotated for this very message.
 */
export const reminderMailFor = (
  to: string,
  unsubscribeToken: string,
  today: IsoDate,
  sinistres: readonly ReminderSinistreForMail[],
): ComposeMailInput => {
  const strings = fr.mail.reminders;
  const declarationDays = sinistres
    .flatMap((sinistre) => sinistre.steps.filter(isDeclaration))
    .map((step) => step.remainingDays);

  return {
    to,
    subject: subjectFor(declarationDays),
    reason: strings.reason,
    unsubscribePath: reminderUnsubscribePathFor(unsubscribeToken),
    blocks: sinistres.flatMap((sinistre) => sinistreBlocks(sinistre, today)),
  };
};

const isDeclaration = (step: ReminderStepForMail): boolean =>
  isDeclarationRule(step.deadlineRuleCode);

/** The subject counts the nearest déclaration deadline the person can still
 * meet, and falls back to the expired one only when none is left: a lost
 * deadline in one dossier must not hide the days left in another. */
const subjectFor = (declarationDays: readonly number[]): string => {
  const strings = fr.mail.reminders.subject;
  const open = declarationDays.filter((days) => days >= 0);
  if (open.length > 0) {
    return strings.declaration(String(Math.min(...open)));
  }
  return declarationDays.length > 0
    ? strings.declarationOverdue
    : strings.nextSteps;
};

const sinistreBlocks = (
  sinistre: ReminderSinistreForMail,
  today: IsoDate,
): MailBlock[] => {
  const strings = fr.mail.reminders;
  const blocks: MailBlock[] = [
    {
      kind: 'paragraph',
      text: strings.sinistreIntro(
        communeLabel(sinistre.commune),
        sinistre.risque,
        formatFrenchDate(sinistre.eventDate),
      ),
    },
  ];

  // The déclaration step is out of the list on purpose: its own paragraph
  // below names the action in words and carries the same date.
  const listed = sinistre.steps.filter((step) => !isDeclaration(step));
  if (listed.length > 0) {
    blocks.push({ kind: 'list', items: listed.map(stepLine) });
  }

  for (const step of sinistre.steps.filter(isDeclaration)) {
    blocks.push(...declarationBlocks(step, today));
  }

  blocks.push({
    kind: 'link',
    text: strings.sinistreLink,
    path: `${SINISTRE_PATH}/${sinistre.id}`,
  });

  return blocks;
};

const stepLine = (step: ReminderStepForMail): string =>
  fr.mail.reminders.stepLine(
    step.name,
    formatFrenchDate(step.plannedDate),
    delayOf(step),
  );

const delayOf = (step: ReminderStepForMail): string => {
  const strings = fr.mail.reminders;
  if (step.remainingDays < 0) {
    const late = String(-step.remainingDays);
    return isInsurerRule(step.deadlineRuleCode)
      ? strings.overdueInsurer(late)
      : strings.overdue(late);
  }
  return step.remainingDays === 0
    ? strings.lastDay
    : strings.inDays(String(step.remainingDays));
};

const declarationBlocks = (
  step: ReminderStepForMail,
  today: IsoDate,
): MailBlock[] => {
  const strings = fr.mail.reminders.declaration;
  const date = formatFrenchDate(step.plannedDate);
  const blocks: MailBlock[] = [
    {
      kind: 'paragraph',
      text:
        step.remainingDays < 0
          ? strings.overdue(date)
          : strings.remaining(String(step.remainingDays), date),
    },
  ];

  if (step.source === null) {
    return blocks;
  }

  const source = toSourceReference(
    step.source.url,
    step.source.verifiedAt,
    today,
  );
  blocks.push({
    kind: 'paragraph',
    text: strings.verifiedAt(formatFrenchDate(source.verifiedAt)),
  });
  if (source.possiblyOutdated) {
    blocks.push({
      kind: 'paragraph',
      text: strings.outdated(String(REFERENCE_DATA_STALE_AFTER_MONTHS)),
    });
  }
  blocks.push({
    kind: 'externalLink',
    text: strings.sourceLink,
    url: source.url,
  });

  return blocks;
};
