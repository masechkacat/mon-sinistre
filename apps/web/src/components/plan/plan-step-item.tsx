import type { ReactNode } from 'react';
import {
  StepKind,
  StepStatus,
  type IsoDate,
  type StepView,
} from '@mon-sinistre/contracts';
import { Button } from '@/components/ui/button';
import { formatDateShortFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { deadlineBadgeState, isUrgentDeadline } from '@/lib/deadline-badge';
import { conteneurLabel } from '@/lib/plan-conteneur';
import type { StepMark } from '@/lib/api/sinistres';
import { cn } from '@/lib/utils';
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

/** One strip of paper on the sheet — the tone the plan is written in. */
const stripClassName =
  'bg-[color-mix(in_oklch,var(--papier),var(--encre)_5%)] p-5 sm:p-6';

export function PlanStepItem({
  step,
  isNext = false,
  contenu,
  itemRef,
  onMark,
}: {
  step: PlanStep;
  isNext?: boolean;
  /** What the step's own space holds, where it is open: the déclaration date. */
  contenu?: ReactNode;
  itemRef?: (node: HTMLLIElement | null) => void;
  onMark?: (mark: StepMark) => void;
}) {
  const copy = fr.sinistres.detail;
  const conteneur = conteneurLabel(step.kind);
  const state = deadlineBadgeState(step);
  // Names the step inside each button, so a reader listing the buttons can
  // tell the steps apart — the two labels repeat across the plan.
  const sujet = (
    <span className="sr-only">{copy.marquer.sujet(step.name)}</span>
  );

  return (
    <li
      ref={itemRef}
      // The focus target a successful mark returns to; nothing focuses the
      // strip when there is nothing to mark.
      tabIndex={onMark ? -1 : undefined}
      aria-current={isNext ? 'step' : undefined}
      className={cn(
        stripClassName,
        'space-y-3',
        // The one strip drawn with a line around it (docs/design/sinistre.html).
        step.kind === StepKind.DECLARATION && 'border-2 border-foreground',
      )}
    >
      <p className="font-heading text-xl leading-tight font-bold sm:text-2xl">
        {step.name}
      </p>
      {step.description ? <p>{step.description}</p> : null}

      {step.plannedDate ? (
        <p className="flex flex-wrap items-baseline gap-x-3 tabular-nums">
          {isUrgentDeadline(state) ? (
            <span className="font-bold text-vermillon">
              {fr.deadlineBadge[state]}
            </span>
          ) : null}
          <span>
            {fr.deadlineBadge.prevueLe(formatDateShortFr(step.plannedDate))}
          </span>
        </p>
      ) : (
        <p className="text-muted-foreground">
          {step.anchor ? copy.attentePar[step.anchor] : copy.sansDateNiAncre}
        </p>
      )}

      {step.plannedDate && step.source ? (
        <SourceNote source={step.source} sujet={step.name} />
      ) : null}

      {contenu}

      {/* The note says the space is not open yet: an open one has content. */}
      {conteneur && !contenu ? (
        <p
          data-slot="plan-conteneur"
          data-kind={step.kind}
          className="border border-dashed border-border p-3 text-sm text-muted-foreground"
        >
          {conteneur}
        </p>
      ) : null}

      {/* Only a step that is an action of its own can be closed: a container
          holds what the dossier gathers, and closing it empty would say the
          damage was listed when it was not (ТЗ § 3.4). */}
      {onMark && step.kind === StepKind.ACTION ? (
        <div className="flex flex-wrap gap-2 pt-1">
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
        </div>
      ) : null}
    </li>
  );
}
