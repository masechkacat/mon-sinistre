import type { DeclarationDeadline } from '@mon-sinistre/contracts';
import { DeadlineBadge } from '@/components/deadline-badge';
import { fr } from '@/i18n/fr';
import { DeadlineBadgeState, deadlineBadgeState } from '@/lib/deadline-badge';
import { SourceNote } from './source-note';

/**
 * The déclaration deadline of a dossier. With `apercu` — the page of a
 * dossier nobody saved yet — an expired deadline is named in words: no count
 * of the days past it and no estimate of what it costs
 * (docs/prd/dossier-preliminaire.md).
 */
export function DeclarationDeadlineBlock({
  deadline,
  apercu = false,
}: {
  deadline: DeclarationDeadline;
  apercu?: boolean;
}) {
  const copy = fr.sinistres.detail.deadline;
  const state = deadlineBadgeState({ daysLeft: deadline.daysLeft });
  const expire = apercu && state === DeadlineBadgeState.enRetard;

  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">{copy.heading}</h2>
      {expire ? (
        <p data-slot="delai-expire" className="text-lg font-semibold">
          {fr.dossier.delaiExpire}
        </p>
      ) : (
        <DeadlineBadge
          form="hero"
          state={state}
          date={deadline.date}
          daysLeft={deadline.daysLeft}
        />
      )}
      <SourceNote source={deadline.source} sujet={copy.heading} />
    </section>
  );
}
