import type { IsoDate, Step } from '@mon-sinistre/contracts';
import { Stamp, capsClassName } from '@/components/stamp';
import { dateParts, formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { DeadlineBadgeState, isUrgentDeadline } from '@/lib/deadline-badge';
import { cn } from '@/lib/utils';

export interface DeadlineBadgeProps {
  state: DeadlineBadgeState;
  date: IsoDate | null;
  daysLeft: number | null;
  completedAt?: IsoDate | null;
  delay?: Step['delay'];
  anchor?: Step['anchor'];
}

interface Material {
  dated?: boolean;
  quiet?: boolean;
  dashed?: boolean;
  stamped?: boolean;
  explained?: boolean;
}

const material: Record<DeadlineBadgeState, Material> = {
  [DeadlineBadgeState.normal]: { dated: true },
  [DeadlineBadgeState.lastWeek]: { dated: true },
  [DeadlineBadgeState.tomorrow]: { dated: true },
  [DeadlineBadgeState.today]: { dated: true },
  [DeadlineBadgeState.overdue]: { dated: true },
  [DeadlineBadgeState.fait]: { dated: true, quiet: true, stamped: true },
  [DeadlineBadgeState.nonApplicable]: { quiet: true, dashed: true },
  [DeadlineBadgeState.upcomingDate]: { explained: true },
};

const copy = fr.deadlineBadge;

function stateWord(
  state: DeadlineBadgeState,
  completedAt: IsoDate | null,
): string | null {
  if (state === DeadlineBadgeState.normal) return null;
  if (state === DeadlineBadgeState.fait) {
    return copy.fait(completedAt && formatDateFr(completedAt));
  }
  return copy[state];
}

const perforation =
  "relative pt-3 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-3 before:content-[''] " +
  'before:[background-image:radial-gradient(circle_at_50%_0,var(--background)_0,var(--background)_3.5px,transparent_4px)] ' +
  'before:[background-repeat:repeat-x] before:[background-size:11px_11px]';
const secondSheet =
  'shadow-[4px_4px_0_0_var(--papier),4px_4px_0_1px_var(--filet)]';

/**
 * The deadline of a dossier as a tear-off sheet. One form, the head of the
 * screen it belongs to: the plan says the state of its steps in the words of
 * their date lines (docs/research/sinistre-dossier.md).
 */
export function DeadlineBadge({
  state,
  date,
  daysLeft,
  completedAt = null,
  delay = null,
  anchor = null,
}: DeadlineBadgeProps) {
  const { dated, quiet, dashed, stamped, explained } = material[state];
  const word = stateWord(state, completedAt);
  const parts = dated && date ? dateParts(date) : null;
  const signal = isUrgentDeadline(state) ? 'text-vermillon' : undefined;
  const countdown =
    dated && daysLeft !== null && !stamped ? copy.countdown(daysLeft) : null;

  return (
    <div
      data-slot="deadline-badge"
      data-surface="papier"
      data-state={state}
      className={cn(
        perforation,
        'w-full max-w-60 bg-card px-4 pb-3 text-center',
        dashed
          ? 'border-2 border-dashed border-border'
          : cn('border border-border', secondSheet),
        quiet ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {/* The word has a line of its own, hence the wrapper: `mb-1` on the
          stamp itself would not clear the figure below it. */}
      {word ? (
        <div className="mb-1">
          {stamped ? (
            <Stamp className={cn(signal, 'mx-auto')}>{word}</Stamp>
          ) : (
            <p className={cn(capsClassName, signal)}>{word}</p>
          )}
        </div>
      ) : null}

      {countdown ? (
        <p className={cn('text-[1.75rem] font-bold tabular-nums', signal)}>
          {countdown}
        </p>
      ) : null}
      {parts ? (
        <p className={cn(capsClassName, 'text-muted-foreground')}>
          {parts.month}
        </p>
      ) : null}
      <Figure text={parts?.day ?? null} signal={signal} />
      {parts ? (
        <p className={cn(capsClassName, 'text-muted-foreground')}>
          {parts.weekday}
        </p>
      ) : null}

      {explained && delay ? (
        <p className="mt-1 text-sm">{copy.duration(delay, anchor)}</p>
      ) : null}
    </div>
  );
}

function Figure({ text, signal }: { text: string | null; signal?: string }) {
  return (
    <p
      data-slot="deadline-number"
      className={cn(
        'font-heading text-[4.25rem] leading-none font-bold tabular-nums',
        signal,
      )}
      aria-hidden={text === null ? true : undefined}
    >
      {text ?? copy.noDate}
    </p>
  );
}
