import { normalizeCommuneName } from '../communes/normalize-commune-name';

/** The referential fields `matchCommune` needs, independent of how the caller fetched them. */
export interface CommuneReferentialEntry {
  codeInsee: string;
  nameNormalized: string | null;
  departementName: string;
  /** null = the code is effective in the current COG. */
  effectiveTo: Date | null;
}

/**
 * Matches an annexe row's raw commune and département names against the
 * commune referential — docs/research/jorf-monitor.md, "Сопоставление коммун
 * со справочником".
 */
export function matchCommune(
  communes: CommuneReferentialEntry[],
  communeLabelRaw: string,
  departementRaw: string,
): string | null {
  const nameKey = normalizeCommuneName(communeLabelRaw);
  const departementKey = normalizeCommuneName(departementRaw);

  const candidates = communes.filter(
    (commune) =>
      commune.nameNormalized === nameKey &&
      normalizeCommuneName(commune.departementName) === departementKey,
  );

  const current = candidates.filter((commune) => commune.effectiveTo === null);
  const pool = current.length > 0 ? current : candidates;

  return pool.length === 1 ? (pool.at(0)?.codeInsee ?? null) : null;
}
