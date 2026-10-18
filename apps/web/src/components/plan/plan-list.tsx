import { StepKind } from '@mon-sinistre/contracts';
import type { ReactNode } from 'react';
import { fr } from '@/i18n/fr';
import type { StepMark } from '@/lib/api/sinistres';
import { nextUpcomingStep, partitionSteps } from '@/lib/sinistre-timeline';
import { EtapeEnCours } from './etape-en-cours';
import { FaitLigne } from './fait-ligne';
import { PlanStepItem, type PlanStep } from './plan-step-item';

/**
 * The plan of a dossier: the bookmark of where it stands, the strips of what
 * is left to do, then the row of what is behind. Without `onMark` and
 * `declaration` all three are read-only — the mode `/dossier` shows, where
 * nothing is stored to be marked.
 */
export function PlanList<T extends PlanStep>({
  steps,
  declaration,
  itemRef,
  onMark,
}: {
  steps: T[];
  /** The déclaration date, inside the strip of the step that asks for it —
   * or on its line once recorded, since the date is what closes that step. */
  declaration?: ReactNode;
  itemRef?: (step: T, node: HTMLLIElement | null) => void;
  onMark?: (step: T, mark: StepMark) => void;
}) {
  const { open, closed } = partitionSteps(steps);
  const next = nextUpcomingStep(open);

  return (
    <>
      <EtapeEnCours etape={next} steps={steps} />
      <ol aria-label={fr.sinistres.detail.timelineLabel} className="space-y-4">
        {open.map((step) => (
          <PlanStepItem
            key={step.id ?? step.order}
            step={step}
            isNext={step === next}
            contenu={step.kind === StepKind.DECLARATION ? declaration : null}
            itemRef={itemRef && ((node) => itemRef(step, node))}
            onMark={onMark && ((mark) => onMark(step, mark))}
          />
        ))}
      </ol>
      {closed.length > 0 ? (
        <FaitLigne
          steps={closed}
          declaration={declaration}
          itemRef={itemRef}
          onMark={onMark}
        />
      ) : null}
    </>
  );
}
