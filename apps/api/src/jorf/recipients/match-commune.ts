import { normalizeCommuneName } from '../../communes/normalize-commune-name';

/**
 * The referential fields `matchCommune` needs, independent of how the caller
 * fetched them. `departementNameNormalized` is precomputed by the caller
 * (not just `departementName` raw): a caller matching hundreds of entries
 * against the same referential must normalize it once, not once per entry
 * per candidate commune.
 */
export interface CommuneReferentialEntry {
  codeInsee: string;
  nameNormalized: string | null;
  departementNameNormalized: string;
  /** null = the code is effective in the current COG. */
  effectiveTo: Date | null;
}

/**
 * A commune name the annexe writes with its article moved to the back, as the
 * COG's own `libellé` column does — "Pouzin (Le)", "Escarène (L')" — while the
 * referential stores the name as it is read. Matched on the normalized key, so
 * case and the two apostrophes are already unified.
 */
const POSTPOSITIONED_ARTICLE = /^(.+?) \((le|la|les|l')\)$/;

/** The same name in referential order, or null if the label has no trailing article. Only the elided `l'` joins without a space. */
function withArticleUpFront(nameKey: string): string | null {
  const match = POSTPOSITIONED_ARTICLE.exec(nameKey);
  if (!match) {
    return null;
  }
  const [, name, article] = match;
  return article === "l'" ? `${article}${name}` : `${article} ${name}`;
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
  const frontKey = withArticleUpFront(nameKey);
  const nameKeys = frontKey ? [nameKey, frontKey] : [nameKey];

  const candidates = communes.filter(
    (commune) =>
      commune.nameNormalized !== null &&
      nameKeys.includes(commune.nameNormalized) &&
      commune.departementNameNormalized === departementKey,
  );

  const current = candidates.filter((commune) => commune.effectiveTo === null);
  const pool = current.length > 0 ? current : candidates;

  return pool.length === 1 ? (pool.at(0)?.codeInsee ?? null) : null;
}
