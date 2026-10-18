import type { SinistreStatus } from '@mon-sinistre/contracts';
import { PageTitle } from '@/components/page-title';
import type { TimelinePoint } from '@/lib/dossier-timeline';
import { DossierTimeline } from './dossier-timeline';
import { StatusStamp } from './status-stamp';

/**
 * The head of a dossier screen: what it is about, where it stands, its key
 * dates, and in `badge` the one deadline that is no step. `children` take what
 * belongs to a single screen, under the chronology.
 */
export function DossierHeader({
  title,
  status,
  points,
  badge,
  children,
}: {
  title: string;
  status: SinistreStatus;
  points: TimelinePoint[];
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section
      data-slot="dossier-header"
      className="grid items-start gap-x-8 gap-y-6 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="space-y-4">
        <StatusStamp status={status} />
        <PageTitle>{title}</PageTitle>
        <DossierTimeline points={points} />
        {children}
      </div>
      {badge}
    </section>
  );
}
