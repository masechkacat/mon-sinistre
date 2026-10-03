import type { Sinistre } from '@mon-sinistre/contracts';
import { fr } from '@/i18n/fr';
import { communeLabel } from './commune-label';

export function dossierTitle(sinistre: Sinistre): string {
  return fr.sinistres.liste.dossierLabel(
    fr.sinistres.risque.options[sinistre.risque].label,
    communeLabel(sinistre.commune),
  );
}
