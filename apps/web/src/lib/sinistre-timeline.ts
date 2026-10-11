import {
  StepStatus,
  type IsoDate,
  type StepView,
} from '@mon-sinistre/contracts';

const UPCOMING: ReadonlySet<StepStatus> = new Set([
  StepStatus.A_FAIRE,
  StepStatus.A_VENIR,
]);

type Dated<T> = T & { plannedDate: IsoDate };

function isUpcomingDated<T extends StepView>(step: T): step is Dated<T> {
  return UPCOMING.has(step.status) && step.plannedDate !== null;
}

export function nextUpcomingStep<T extends StepView>(steps: T[]): T | null {
  let next: Dated<T> | null = null;
  for (const step of steps) {
    if (!isUpcomingDated(step)) continue;
    if (next === null || step.plannedDate < next.plannedDate) next = step;
  }
  return next;
}
