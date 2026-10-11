import type { Sinistre } from '@mon-sinistre/contracts';
import { fr } from '@/i18n/fr';
import { communeLabel } from './commune-label';

/** The commune and risk alone, so an aperçu — which has no identity — fits too. */
export function dossierTitle({
  commune,
  risque,
}: Pick<Sinistre, 'commune' | 'risque'>): string {
  return fr.sinistres.liste.dossierLabel(
    fr.sinistres.risque.options[risque].label,
    communeLabel(commune),
  );
}
