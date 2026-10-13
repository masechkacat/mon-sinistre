import {
  StepStatus,
  type IsoDate,
  type StepView,
} from '@mon-sinistre/contracts';
import { DeadlineBadge } from '@/components/deadline-badge';
import { Button } from '@/components/ui/button';
import { fr } from '@/i18n/fr';
import { DeadlineBadgeState, deadlineBadgeState } from '@/lib/deadline-badge';
import { conteneurLabel } from '@/lib/plan-conteneur';
import type { StepMark } from '@/lib/api/sinistres';
import { SourceNote } from './source-note';

/**
 * What both screens show: a {@link StepView}, plus the identity and the mark a
 * step stored in a sinistre carries. `/dossier` passes an aperçu step, which
 * has neither.
 */
export interface PlanStep extends StepView {
  id?: string;
  completedAt?: IsoDate | null;
}

export function PlanStepItem({
  step,
  isNext = false,
  itemRef,
  onMark,
  apercu = false,
}: {
  step: PlanStep;
  isNext?: boolean;
  itemRef?: (node: HTMLLIElement | null) => void;
  onMark?: (mark: StepMark) => void;
  apercu?: boolean;
}) {
  const copy = fr.sinistres.detail;
  const conteneur = conteneurLabel(step.kind);
  const state = deadlineBadgeState(step);
  const isClosed =
    step.status === StepStatus.FAIT ||
    step.status === StepStatus.NON_APPLICABLE;
  // Names the step inside each button, so a reader listing the buttons can
  // tell the steps apart — the three labels repeat across the timeline.
  const sujet = (
    <span className="sr-only">{copy.marquer.sujet(step.name)}</span>
  );

  return (
    <li
      ref={itemRef}
      // The focus target a successful mark returns to; nothing focuses the
      // item when there is nothing to mark.
      tabIndex={onMark ? -1 : undefined}
      aria-current={isNext ? 'step' : undefined}
      className="space-y-2 rounded-lg border p-4"
    >
      <p className="text-lg font-medium">{step.name}</p>
      {isNext ? (
        <p className="text-sm font-semibold">{copy.prochaineEtape}</p>
      ) : null}
      <DeadlineBadge
        form="row"
        state={state}
        date={step.plannedDate}
        daysLeft={
          apercu && state === DeadlineBadgeState.enRetard ? null : step.daysLeft
        }
        completedAt={step.completedAt}
        delay={step.delay}
        anchor={step.anchor}
      />
      {step.plannedDate && step.source && !isClosed ? (
        <SourceNote source={step.source} sujet={step.name} />
      ) : null}
      {!step.plannedDate && !isClosed ? (
        <p className="text-sm text-muted-foreground">
          {step.anchor ? copy.attentePar[step.anchor] : copy.sansDateNiAncre}
        </p>
      ) : null}
      {onMark ? (
        <div className="flex flex-wrap gap-2 pt-2">
          {isClosed ? (
            <Button variant="outline" size="touch" onClick={() => onMark(null)}>
              {copy.marquer.annuler}
              {sujet}
            </Button>
          ) : (
            <>
              <Button size="touch" onClick={() => onMark(StepStatus.FAIT)}>
                {copy.marquer.fait}
                {sujet}
              </Button>
              <Button
                variant="outline"
                size="touch"
                onClick={() => onMark(StepStatus.NON_APPLICABLE)}
              >
                {copy.marquer.nonApplicable}
                {sujet}
              </Button>
            </>
          )}
        </div>
      ) : conteneur ? (
        <p
          data-slot="plan-conteneur"
          data-kind={step.kind}
          className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground"
        >
          {conteneur}
        </p>
      ) : null}
    </li>
  );
}
