import { RisqueCatnat } from '@mon-sinistre/contracts';
import { normalizeCommuneName } from 'src/communes/normalize-commune-name';

/**
 * Folds a JO phénomène-naturel wording into the `RisqueCatnat` values it
 * covers — docs/research/sinistre-plan.md, "Классификация риска" owns the
 * mapping and its rationale.
 *
 * @returns the matching values, empty if the wording is not one the JO has
 * printed before — the caller alerts on that, this function stays pure.
 */
export const classifyRisques = (label: string): Set<RisqueCatnat> => {
  const normalized = normalizeCommuneName(label);

  // Not matched on "secheresse" alone: "hors sécheresse géotechnique", part
  // of the plain mouvement-de-terrain wording, contains it too.
  if (normalized.includes('rehydratation')) {
    return new Set([RisqueCatnat.SECHERESSE]);
  }

  const result = new Set<RisqueCatnat>();
  if (normalized.includes('inondation') || normalized.includes('submersion')) {
    result.add(RisqueCatnat.INONDATION);
  }
  if (normalized.includes('mouvement') && normalized.includes('terrain')) {
    result.add(RisqueCatnat.MOUVEMENT_TERRAIN);
  }
  if (normalized.includes('seisme') || normalized.includes('volcan')) {
    result.add(RisqueCatnat.SEISME);
  }
  if (normalized.includes('avalanche')) {
    result.add(RisqueCatnat.AVALANCHE);
  }
  if (normalized.includes('cyclon')) {
    result.add(RisqueCatnat.VENTS_CYCLONIQUES);
  }
  return result;
};
