import type { Commune } from '@mon-sinistre/contracts';

export function communeLabel(
  commune: Pick<Commune, 'name' | 'departementName'>,
) {
  return `${commune.name} (${commune.departementName})`;
}
