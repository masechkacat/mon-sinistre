import { fr } from '@/i18n/fr';
import type { StepMark } from '@/lib/api/sinistres';
import { nextUpcomingStep } from '@/lib/sinistre-timeline';
import { PlanStepItem, type PlanStep } from './plan-step-item';

/**
 * The plan of a dossier. Without `onMark` the list is read-only — the mode
 * `/dossier` shows, where nothing is stored to be marked. With `apercu` an
 * overdue step carries no count of the days past it, as the deadline block.
 */
export function PlanList<T extends PlanStep>({
  steps,
  itemRef,
  onMark,
  apercu = false,
}: {
  steps: T[];
  itemRef?: (step: T, node: HTMLLIElement | null) => void;
  onMark?: (step: T, mark: StepMark) => void;
  apercu?: boolean;
}) {
  const next = nextUpcomingStep(steps);

  return (
    <ol aria-label={fr.sinistres.detail.timelineLabel} className="space-y-4">
      {steps.map((step) => (
        <PlanStepItem
          key={step.id ?? step.order}
          step={step}
          isNext={step === next}
          itemRef={itemRef && ((node) => itemRef(step, node))}
          onMark={onMark && ((mark) => onMark(step, mark))}
          apercu={apercu}
        />
      ))}
    </ol>
  );
}
