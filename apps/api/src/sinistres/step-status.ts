import {
  SOON_THRESHOLD_DAYS,
  StepStatus,
  type IsoDate,
} from '@mon-sinistre/contracts';
import type { StepPersistedStatus } from 'src/generated/prisma/enums';
import { DAY_MS } from 'src/common/time/time';
import { isoDateToDate } from 'src/deadline-rules/resolve-deadline';

export interface StepStatusInput {
  plannedDate: IsoDate | null;
  /** The only two `StepStatus` values the database actually stores. */
  persistedStatus: StepPersistedStatus | null;
}

/** Whole calendar days from `from` to `to`, both `IsoDate`. */
function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round(
    (isoDateToDate(to).getTime() - isoDateToDate(from).getTime()) / DAY_MS,
  );
}

/**
 * Derives every `StepStatus` but `FAIT`/`NON_APPLICABLE`, which are read
 * straight off `persistedStatus` instead (docs/research/sinistre-plan.md,
 * "Статусы шагов на чтении").
 */
export function stepStatus(step: StepStatusInput, today: IsoDate): StepStatus {
  if (step.persistedStatus === 'FAIT') {
    return StepStatus.FAIT;
  }
  if (step.persistedStatus === 'NON_APPLICABLE') {
    return StepStatus.NON_APPLICABLE;
  }
  if (step.plannedDate === null) {
    return StepStatus.A_VENIR;
  }
  if (step.plannedDate < today) {
    return StepStatus.EN_RETARD;
  }
  return daysBetween(today, step.plannedDate) <= SOON_THRESHOLD_DAYS
    ? StepStatus.A_FAIRE
    : StepStatus.A_VENIR;
}
