import { StepStatus, type IsoDate, type Step } from '@mon-sinistre/contracts';

const UPCOMING: ReadonlySet<StepStatus> = new Set([
  StepStatus.A_FAIRE,
  StepStatus.A_VENIR,
]);

type DatedStep = Step & { plannedDate: IsoDate };

function isUpcomingDated(step: Step): step is DatedStep {
  return UPCOMING.has(step.status) && step.plannedDate !== null;
}

export function nextUpcomingStep(steps: Step[]): Step | null {
  let next: DatedStep | null = null;
  for (const step of steps) {
    if (!isUpcomingDated(step)) continue;
    if (next === null || step.plannedDate < next.plannedDate) next = step;
  }
  return next;
}
