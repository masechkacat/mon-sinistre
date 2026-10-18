import type { SinistreStatus } from '@mon-sinistre/contracts';
import { Tampon } from '@/components/tampon';
import { fr } from '@/i18n/fr';

/** Where the dossier stands, stamped next to the event it is about. */
export function StatutTampon({ status }: { status: SinistreStatus }) {
  return (
    <Tampon data-slot="statut-tampon" className="text-base">
      {fr.sinistres.statut[status]}
    </Tampon>
  );
}
