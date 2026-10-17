import { Button } from '@/components/ui/button';
import { fr } from '@/i18n/fr';
import type { StepMark } from '@/lib/api/sinistres';
import type { PlanStep } from './plan-step-item';

/**
 * What is already behind: the settled steps, out of the list of what is left
 * to do and numbered in the order of the plan. With `onMark` each of them
 * keeps the way back into the plan.
 */
export function FaitLigne<T extends PlanStep>({
  steps,
  itemRef,
  onMark,
}: {
  steps: T[];
  itemRef?: (step: T, node: HTMLLIElement | null) => void;
  onMark?: (step: T, mark: StepMark) => void;
}) {
  const copy = fr.sinistres.detail;

  return (
    <section
      data-slot="plan-fait"
      className="mt-8 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-border pt-4"
    >
      <h2 className="font-heading text-lg italic">{copy.faits.titre}</h2>
      <ol
        aria-label={copy.faits.liste}
        className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-muted-foreground"
      >
        {steps.map((step, index) => (
          <li
            key={step.id ?? step.order}
            ref={itemRef && ((node) => itemRef(step, node))}
            tabIndex={onMark ? -1 : undefined}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            {/* The place in the row, as on the sheet; the list itself tells a
                reader the same thing. */}
            <span aria-hidden className="tabular-nums">
              {index + 1}
            </span>
            <span>{step.name}</span>
            {onMark ? (
              <Button
                variant="link"
                size="touch"
                onClick={() => onMark(step, null)}
              >
                {copy.marquer.annuler}
                <span className="sr-only">{copy.marquer.sujet(step.name)}</span>
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
