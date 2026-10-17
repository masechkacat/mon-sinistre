import { fr } from '@/i18n/fr';
import type { StepMark } from '@/lib/api/sinistres';
import { nextUpcomingStep, partitionSteps } from '@/lib/sinistre-timeline';
import { FaitLigne } from './fait-ligne';
import { PlanStepItem, type PlanStep } from './plan-step-item';

/**
 * The plan of a dossier: the strips of what is left to do, then the row of
 * what is behind. Without `onMark` both are read-only — the mode `/dossier`
 * shows, where nothing is stored to be marked.
 */
export function PlanList<T extends PlanStep>({
  steps,
  itemRef,
  onMark,
}: {
  steps: T[];
  itemRef?: (step: T, node: HTMLLIElement | null) => void;
  onMark?: (step: T, mark: StepMark) => void;
}) {
  const { open, closed } = partitionSteps(steps);
  const next = nextUpcomingStep(open);

  return (
    <>
      <ol aria-label={fr.sinistres.detail.timelineLabel} className="space-y-4">
        {open.map((step) => (
          <PlanStepItem
            key={step.id ?? step.order}
            step={step}
            isNext={step === next}
            itemRef={itemRef && ((node) => itemRef(step, node))}
            onMark={onMark && ((mark) => onMark(step, mark))}
          />
        ))}
      </ol>
      {closed.length > 0 ? (
        <FaitLigne steps={closed} itemRef={itemRef} onMark={onMark} />
      ) : null}
    </>
  );
}
