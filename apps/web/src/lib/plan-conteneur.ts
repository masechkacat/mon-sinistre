import { StepKind } from '@mon-sinistre/contracts';
import { fr } from '@/i18n/fr';

/**
 * What the step's container is named on screen — null for a plain action,
 * which has no container at all (contracts, `StepKind`).
 */
export function conteneurLabel(kind: StepKind): string | null {
  return kind === StepKind.ACTION ? null : fr.dossier.conteneur[kind];
}
