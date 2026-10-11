import type { DeclarationDeadline } from '@mon-sinistre/contracts';
import {
  DeadlineBadge,
  type DeadlineBadgeProps,
} from '@/components/deadline-badge';
import { fr } from '@/i18n/fr';
import { DeadlineBadgeState, deadlineBadgeState } from '@/lib/deadline-badge';
import { SourceNote } from './source-note';

/** The déclaration deadline of a dossier, under a heading of its own. */
export function DeclarationDeadlineBlock({
  deadline,
  apercu = false,
}: {
  deadline: DeclarationDeadline;
  apercu?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">
        {fr.sinistres.detail.deadline.heading}
      </h2>
      <DeclarationDeadlineValue
        deadline={deadline}
        form="hero"
        apercu={apercu}
      />
    </section>
  );
}

/**
 * The deadline itself and its source, for a caller that labels it on its own —
 * the commune answer, where every arrêté carries one. With `apercu` — a
 * dossier nobody saved yet — an expired deadline is named in words: no count
 * of the days past it and no estimate of what it costs
 * (docs/prd/dossier-preliminaire.md).
 */
export function DeclarationDeadlineValue({
  deadline,
  form,
  apercu = false,
}: {
  deadline: DeclarationDeadline;
  form: DeadlineBadgeProps['form'];
  apercu?: boolean;
}) {
  const state = deadlineBadgeState({ daysLeft: deadline.daysLeft });
  const expire = apercu && state === DeadlineBadgeState.enRetard;

  return (
    <>
      {expire ? (
        <p data-slot="delai-expire" className="text-lg font-semibold">
          {fr.dossier.delaiExpire}
        </p>
      ) : (
        <DeadlineBadge
          form={form}
          state={state}
          date={deadline.date}
          daysLeft={deadline.daysLeft}
        />
      )}
      <SourceNote
        source={deadline.source}
        sujet={fr.sinistres.detail.deadline.heading}
      />
    </>
  );
}
