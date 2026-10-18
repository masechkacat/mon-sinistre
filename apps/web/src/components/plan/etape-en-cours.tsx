import type { StepView } from '@mon-sinistre/contracts';
import { capsClassName } from '@/components/tampon';
import { fr } from '@/i18n/fr';
import { progressionPlan } from '@/lib/sinistre-timeline';
import { cn } from '@/lib/utils';

/**
 * The bookmark of the sheet (docs/design/sinistre.html, 16b): the step in hand
 * on a pétrole tab against the top edge, and next to it how much of the plan
 * is behind — a count and the bar that draws it. `etape` comes from the list
 * that marks it `aria-current`, so the two name the same step.
 */
export function EtapeEnCours({
  etape,
  steps,
}: {
  etape: StepView | null;
  steps: StepView[];
}) {
  const copy = fr.sinistres.detail.etapeEnCours;
  const { faites, total } = progressionPlan(steps);
  // A scale out of nothing is read as « 0 sur 0 » and drawn as a bar with no
  // length: a dossier without a plan has no progress to show at all.
  if (total === 0) return null;

  return (
    <section
      data-slot="etape-en-cours"
      className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4"
    >
      {etape ? (
        <p
          className={cn(
            // Pulled up by the margin of the sheet, so the tab hangs from its
            // top edge instead of floating under it.
            '-mt-(--marge-feuille) bg-primary px-5 pt-4 pb-3 text-primary-foreground',
            'shadow-[0_2px_0_color-mix(in_oklch,var(--petrole),var(--encre)_45%)]',
          )}
        >
          <span className={cn(capsClassName, 'block')}>{copy.titre}</span>
          <span className="block font-heading text-2xl leading-tight sm:text-3xl">
            {etape.name}
          </span>
        </p>
      ) : null}
      <div className="min-w-55 flex-1 space-y-2">
        <p className="tabular-nums text-muted-foreground">
          {copy.progression(faites, total)}
        </p>
        <div
          role="progressbar"
          aria-label={copy.avancement}
          aria-valuenow={faites}
          aria-valuemax={total}
          // Without it the bar is read as a percentage, and the screen says
          // steps: the same sentence, so no second phrasing appears.
          aria-valuetext={copy.progression(faites, total)}
          className="h-[3px] bg-border"
        >
          <div
            className="h-full bg-primary"
            style={{ width: `${(faites / total) * 100}%` }}
          />
        </div>
      </div>
    </section>
  );
}
