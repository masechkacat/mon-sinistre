import type { SinistreStatus } from '@mon-sinistre/contracts';
import { PageTitle } from '@/components/page-title';
import type { ChronologiePoint } from '@/lib/dossier-chronologie';
import { DossierChronologie } from './dossier-chronologie';
import { StatutTampon } from './statut-tampon';

/**
 * The head of a dossier screen: what it is about, where it stands, its key
 * dates, and in `badge` the one deadline that is no step. `children` take what
 * belongs to a single screen, under the chronology.
 */
export function DossierEntete({
  title,
  status,
  points,
  badge,
  children,
}: {
  title: string;
  status: SinistreStatus;
  points: ChronologiePoint[];
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section
      data-slot="dossier-entete"
      className="grid items-start gap-x-8 gap-y-6 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="space-y-4">
        <StatutTampon status={status} />
        <PageTitle>{title}</PageTitle>
        <DossierChronologie points={points} />
        {children}
      </div>
      {badge}
    </section>
  );
}
