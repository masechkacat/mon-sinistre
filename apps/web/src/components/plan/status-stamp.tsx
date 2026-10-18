import type { SinistreStatus } from '@mon-sinistre/contracts';
import { Stamp } from '@/components/stamp';
import { fr } from '@/i18n/fr';

/** Where the dossier stands, stamped next to the event it is about. */
export function StatusStamp({ status }: { status: SinistreStatus }) {
  return (
    <Stamp data-slot="status-stamp" className="text-base">
      {fr.sinistres.status[status]}
    </Stamp>
  );
}
