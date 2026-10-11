import { RisqueCatnat } from '@mon-sinistre/contracts';

/** Every category, in the order of the enum. */
export const RISQUES: readonly RisqueCatnat[] = Object.values(RisqueCatnat);

export function isRisque(value: string): value is RisqueCatnat {
  return (RISQUES as readonly string[]).includes(value);
}
