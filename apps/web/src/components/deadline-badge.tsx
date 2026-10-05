import type { IsoDate, Step } from '@mon-sinistre/contracts';
import { dateParts, formatDateFr, formatDateShortFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { DeadlineBadgeState } from '@/lib/deadline-badge';
import { cn } from '@/lib/utils';

/**
 * A tear-off calendar sheet carrying one date and how far away it is: `hero`
 * for the declaration deadline at the top of a dossier, `row` for a step of
 * the plan. The state comes from `deadlineBadgeState`, computed on the fields
 * of the API — the badge only draws it.
 *
 * Both forms read in the same order they are spoken: the word of the state,
 * the days left, then the date.
 */
export interface DeadlineBadgeProps {
  form: 'hero' | 'row';
  state: DeadlineBadgeState;
  /** The date the badge counts to; null while the step's anchor is unknown. */
  date: IsoDate | null;
  daysLeft: number | null;
  /** The day the step was marked done, stamped on the sheet. */
  completedAt?: IsoDate | null;
  /** The window of the step's deadline rule, read by « date à venir ». */
  delay?: Step['delay'];
  /** What the window is counted from. */
  anchor?: Step['anchor'];
}

interface Material {
  /** The sheet shows its date and, unless done, the days left. */
  dated?: boolean;
  /** The number and the countdown take the signal colour. */
  urgent?: boolean;
  /** The sheet steps back: nothing about a settled step is highlighted. */
  quiet?: boolean;
  /** Told apart from a done step by its shape, not by its colour. */
  dashed?: boolean;
  /** The word of the state is a stamp struck across the sheet. */
  stamped?: boolean;
  /** The window of the deadline rule stands in for the date it has not got. */
  explained?: boolean;
}

const material: Record<DeadlineBadgeState, Material> = {
  [DeadlineBadgeState.norme]: { dated: true },
  [DeadlineBadgeState.derniereSemaine]: { dated: true, urgent: true },
  [DeadlineBadgeState.demain]: { dated: true, urgent: true },
  [DeadlineBadgeState.aujourdhui]: { dated: true, urgent: true },
  [DeadlineBadgeState.enRetard]: { dated: true, urgent: true },
  [DeadlineBadgeState.fait]: { dated: true, quiet: true, stamped: true },
  [DeadlineBadgeState.sansObjet]: { quiet: true, dashed: true },
  [DeadlineBadgeState.dateAVenir]: { explained: true },
};

const copy = fr.deadlineBadge;

function stateWord(
  state: DeadlineBadgeState,
  completedAt: IsoDate | null,
): string | null {
  if (state === DeadlineBadgeState.norme) return null;
  if (state === DeadlineBadgeState.fait) {
    return copy.fait(completedAt && formatDateFr(completedAt));
  }
  return copy[state];
}

// Dotted top edge and offset second sheet: the paper the badge is made of.
// Both are decoration, so pseudo-elements draw them and the DOM never sees
// them.
const perforation =
  "relative pt-3 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-3 before:content-[''] " +
  'before:[background-image:radial-gradient(circle_at_50%_0,var(--background)_0,var(--background)_3.5px,transparent_4px)] ' +
  'before:[background-repeat:repeat-x] before:[background-size:11px_11px]';
const secondSheet =
  'shadow-[4px_4px_0_0_var(--papier),4px_4px_0_1px_var(--filet)]';

const caps = 'text-[0.8125rem] font-bold tracking-wider uppercase';
const number = 'font-heading leading-none font-bold tabular-nums';

export function DeadlineBadge({
  form,
  state,
  date,
  daysLeft,
  completedAt = null,
  delay = null,
  anchor = null,
}: DeadlineBadgeProps) {
  const { dated, urgent, quiet, dashed, stamped, explained } = material[state];
  const hero = form === 'hero';
  const word = stateWord(state, completedAt);
  const parts = dated && date ? dateParts(date) : null;
  const signal = urgent ? 'text-vermillon' : undefined;
  const countdown =
    dated && daysLeft !== null && !stamped
      ? copy.compteARebours(daysLeft)
      : null;

  return (
    <div
      data-slot="deadline-badge"
      data-surface="papier"
      data-form={form}
      data-state={state}
      className={cn(
        perforation,
        'bg-card px-4 pb-3',
        dashed
          ? 'border-2 border-dashed border-border'
          : cn('border border-border', secondSheet),
        quiet ? 'text-muted-foreground' : 'text-foreground',
        hero
          ? 'w-full max-w-60 text-center'
          : 'flex w-full flex-wrap items-baseline gap-x-4 gap-y-1',
      )}
    >
      {/* The word has a line of its own, hence the wrapper: `basis-full` on
          the stamp itself would stretch it across the whole row. */}
      {word ? (
        <div className={hero ? 'mb-1' : 'basis-full'}>
          <p
            className={cn(
              caps,
              signal,
              stamped &&
                cn(
                  'w-fit -rotate-4 border-2 border-current px-2',
                  hero && 'mx-auto',
                ),
            )}
          >
            {word}
          </p>
        </div>
      ) : null}

      {hero ? (
        <>
          {countdown ? (
            <p className={cn('text-[1.75rem] font-bold tabular-nums', signal)}>
              {countdown}
            </p>
          ) : null}
          {parts ? (
            <p className={cn(caps, 'text-muted-foreground')}>{parts.month}</p>
          ) : null}
          <HeroDay day={parts?.day ?? null} signal={signal} />
          {parts ? (
            <p className={cn(caps, 'text-muted-foreground')}>{parts.weekday}</p>
          ) : null}
        </>
      ) : (
        <>
          <RowNumber countdown={countdown} signal={signal} />
          {parts && date ? (
            <p className="text-[1.0625rem] tabular-nums">
              {formatDateShortFr(date)}
            </p>
          ) : null}
        </>
      )}

      {explained && delay ? (
        <p className={cn('text-sm', hero ? 'mt-1' : 'basis-full')}>
          {copy.delai(delay, anchor)}
        </p>
      ) : null}
    </div>
  );
}

function HeroDay({ day, signal }: { day: string | null; signal?: string }) {
  return (
    <p
      data-slot="deadline-number"
      className={cn(number, 'text-[4.25rem]', signal)}
      aria-hidden={day === null ? true : undefined}
    >
      {day ?? copy.sansDate}
    </p>
  );
}

/** The row has no sheet to fill, so its figure is the countdown itself. */
function RowNumber({
  countdown,
  signal,
}: {
  countdown: string | null;
  signal?: string;
}) {
  return (
    <p
      data-slot="deadline-number"
      className={cn(number, 'text-[3.25rem]', signal)}
      aria-hidden={countdown === null ? true : undefined}
    >
      {countdown ?? copy.sansDate}
    </p>
  );
}
