import {
  DECLARATION_REMINDER_OFFSETS_DAYS,
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

/** One step worth a line in today's mail; `offsetDays` is the remaining days. */
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
    if (
      plannedDate === null ||
      step.persistedStatus !== null ||
      plannedDate < today
    ) {
      continue;
    }
    const reason = scaleReason(step, plannedDate, today);
    if (reason !== null) {
      reasons.push(reason);
    }
  }

  return reasons;
}
