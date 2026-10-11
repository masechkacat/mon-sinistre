import type { DeclarationDeadline } from '@mon-sinistre/contracts';
import { DeadlineBadge } from '@/components/deadline-badge';
import { fr } from '@/i18n/fr';
import { deadlineBadgeState } from '@/lib/deadline-badge';
import { SourceNote } from './source-note';

export function DeclarationDeadlineBlock({
  deadline,
}: {
  deadline: DeclarationDeadline;
}) {
  const copy = fr.sinistres.detail.deadline;

  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">{copy.heading}</h2>
      <DeadlineBadge
        form="hero"
        state={deadlineBadgeState({ daysLeft: deadline.daysLeft })}
        date={deadline.date}
        daysLeft={deadline.daysLeft}
      />
      <SourceNote source={deadline.source} sujet={copy.heading} />
    </section>
  );
}
