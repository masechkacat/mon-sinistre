import {
  DECLARATION_REMINDER_OFFSETS_DAYS,
  OVERDUE_REMINDER_INTERVAL_DAYS,
  OVERDUE_REMINDER_MAX_COUNT,
  REMINDER_OFFSETS_DAYS,
  type IsoDate,
} from '@mon-sinistre/contracts';
import { isDeclarationRule } from 'src/deadline-rules/deadline-rule.seed';
import type {
  ReminderKind,
  StepPersistedStatus,
} from 'src/generated/prisma/enums';
import { daysBetween } from 'src/sinistres/step-status';

/** A `ReminderLog` row of a candidate step, whatever `plannedDate` it was left on. */
export interface ReminderCandidateLog {
  kind: ReminderKind;
  offsetDays: number | null;
  plannedDate: IsoDate;
  sentOn: IsoDate;
}

export interface ReminderCandidateStep {
  id: string;
  plannedDate: IsoDate | null;
  persistedStatus: StepPersistedStatus | null;
  /** `DeadlineRule.code` of the step, null when it carries no rule. */
  deadlineRuleCode: string | null;
  logs: readonly ReminderCandidateLog[];
}

/** One step worth a line in today's mail; `offsetDays` is the remaining days,
 * negative once the date has passed (`OVERDUE`). */
export interface ReminderReason {
  stepId: string;
  kind: ReminderKind;
  offsetDays: number;
  plannedDate: IsoDate;
}

/**
 * How far ahead the daily pass must read candidate steps — the widest
 * threshold of either scale, since a step further away than that can be no
 * reason today. Derived from the scales rather than written out: a threshold
 * added to contracts must widen the query by itself.
 */
export const REMINDER_HORIZON_DAYS = Math.max(
  ...REMINDER_OFFSETS_DAYS,
  ...DECLARATION_REMINDER_OFFSETS_DAYS,
);

const scaleOf = (deadlineRuleCode: string | null): readonly number[] =>
  isDeclarationRule(deadlineRuleCode)
    ? DECLARATION_REMINDER_OFFSETS_DAYS
    : REMINDER_OFFSETS_DAYS;

function scaleReason(
  step: ReminderCandidateStep,
  plannedDate: IsoDate,
  today: IsoDate,
): ReminderReason | null {
  const sentOffsets = step.logs.flatMap((log) =>
    log.kind === 'SCALE' &&
    log.plannedDate === plannedDate &&
    log.offsetDays !== null
      ? [log.offsetDays]
      : [],
  );
  // `Math.min` of nothing is `Infinity`: no mail yet means no threshold closed.
  const lowestSent = Math.min(...sentOffsets);
  const open = scaleOf(step.deadlineRuleCode).filter(
    (offset) => offset < lowestSent,
  );
  if (open.length === 0) {
    return null;
  }

  const remaining = daysBetween(today, plannedDate);
  return remaining <= Math.max(...open)
    ? { stepId: step.id, kind: 'SCALE', offsetDays: remaining, plannedDate }
    : null;
}

function overdueReason(
  step: ReminderCandidateStep,
  plannedDate: IsoDate,
  today: IsoDate,
): ReminderReason | null {
  const overdue = step.logs.filter((log) => log.kind === 'OVERDUE');
  // Without this, a step whose `plannedDate` moved today would open a new
  // series the same day, and `unique(stepId, sentOn)` of the log would reject
  // the write once the mail had already gone out.
  if (overdue.some((log) => log.sentOn === today)) {
    return null;
  }

  const sentOn = overdue.flatMap((log) =>
    log.plannedDate === plannedDate ? [log.sentOn] : [],
  );
  if (sentOn.length >= OVERDUE_REMINDER_MAX_COUNT) {
    return null;
  }

  const lastSentOn = sentOn.sort().at(-1);
  if (
    lastSentOn !== undefined &&
    daysBetween(lastSentOn, today) < OVERDUE_REMINDER_INTERVAL_DAYS
  ) {
    return null;
  }

  return {
    stepId: step.id,
    kind: 'OVERDUE',
    offsetDays: daysBetween(today, plannedDate),
    plannedDate,
  };
}

/**
 * Picks the steps worth a reminder today — pure, over the thresholds of
 * docs/research/sinistre-reminders.md, "Отбор поводов".
 */
export function selectReminders(
  candidates: readonly ReminderCandidateStep[],
  today: IsoDate,
): ReminderReason[] {
  const reasons: ReminderReason[] = [];

  for (const step of candidates) {
    const plannedDate = step.plannedDate;
    if (plannedDate === null || step.persistedStatus !== null) {
      continue;
    }
    const reason =
      plannedDate < today
        ? overdueReason(step, plannedDate, today)
        : scaleReason(step, plannedDate, today);
    if (reason !== null) {
      reasons.push(reason);
    }
  }

  return reasons;
}
