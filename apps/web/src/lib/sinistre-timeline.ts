import { StepStatus, type Step } from '@mon-sinistre/contracts';

const UPCOMING: ReadonlySet<StepStatus> = new Set([
  StepStatus.A_FAIRE,
  StepStatus.A_VENIR,
]);

export function nextUpcomingStep(steps: Step[]): Step | null {
  let next: Step | null = null;
  for (const step of steps) {
    if (!UPCOMING.has(step.status) || step.plannedDate === null) continue;
    if (
      next === null ||
      next.plannedDate === null ||
      step.plannedDate < next.plannedDate
    ) {
      next = step;
    }
  }
  return next;
}
