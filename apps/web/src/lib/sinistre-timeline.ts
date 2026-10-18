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

const CLOSED: ReadonlySet<StepStatus> = new Set([
  StepStatus.FAIT,
  StepStatus.NON_APPLICABLE,
]);

/**
 * The plan split the way the sheet shows it: what is left to do stays the
 * list, what is settled — done or set aside — goes to the row under it. Both
 * keep the order of the plan.
 */
export function partitionSteps<T extends StepView>(
  steps: T[],
): { open: T[]; closed: T[] } {
  const open: T[] = [];
  const closed: T[] = [];
  for (const step of steps) {
    (CLOSED.has(step.status) ? closed : open).push(step);
  }
  return { open, closed };
}

/**
 * How far the plan has come. A step set aside is counted neither as done nor
 * out of the plan: it is still one of the steps the dossier was given, and
 * dropping it from the total would show progress where nothing was done.
 */
export function planProgress(steps: StepView[]): {
  done: number;
  total: number;
} {
  return {
    done: steps.filter(({ status }) => status === StepStatus.FAIT).length,
    total: steps.length,
  };
}

export function nextUpcomingStep<T extends StepView>(steps: T[]): T | null {
  let next: Dated<T> | null = null;
  for (const step of steps) {
    if (!isUpcomingDated(step)) continue;
    if (next === null || step.plannedDate < next.plannedDate) next = step;
  }
  return next;
}
