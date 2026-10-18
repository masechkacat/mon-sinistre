import type { DeclarationDeadline } from '@mon-sinistre/contracts';
import { DeadlineBadge } from '@/components/deadline-badge';
import { fr } from '@/i18n/fr';
import { DeadlineBadgeState, deadlineBadgeState } from '@/lib/deadline-badge';
import { SourceNote } from './source-note';

/** The déclaration deadline of a dossier, under a heading of its own. */
export function DeclarationDeadlineBlock({
  deadline,
  preview = false,
}: {
  deadline: DeclarationDeadline;
  preview?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">
        {fr.sinistres.detail.deadline.heading}
      </h2>
      <DeclarationDeadlineValue deadline={deadline} preview={preview} />
    </section>
  );
}

/**
 * The deadline itself and its source, for a caller that labels it on its own —
 * the commune answer, where every arrêté carries one. With `preview` — a
 * dossier nobody saved yet — an expired deadline is named in words: no count
 * of the days past it and no estimate of what it costs
 * (docs/prd/dossier-preliminaire.md).
 */
export function DeclarationDeadlineValue({
  deadline,
  preview = false,
}: {
  deadline: DeclarationDeadline;
  preview?: boolean;
}) {
  const state = deadlineBadgeState({ daysLeft: deadline.daysLeft });
  const expired = preview && state === DeadlineBadgeState.overdue;

  return (
    <>
      {expired ? (
        <p data-slot="deadline-expired" className="text-lg font-semibold">
          {fr.dossier.deadlineExpired}
        </p>
      ) : (
        <DeadlineBadge
          state={state}
          date={deadline.date}
          daysLeft={deadline.daysLeft}
        />
      )}
      <SourceNote
        source={deadline.source}
        subject={fr.sinistres.detail.deadline.heading}
      />
    </>
  );
}
