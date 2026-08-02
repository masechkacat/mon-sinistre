/**
 * Search key of a commune name: case- and accent-insensitive.
 *
 * The same function fills the `nameNormalized` column at import time and
 * normalizes the `q` of a search query, so the write side and the read side
 * cannot drift apart (decision: docs/research/commune-referential.md).
 *
 * Apostrophes, hyphens and spaces are deliberately kept: "lhay" does not find
 * "L'Haÿ-les-Roses". Dropping them would need the same treatment on both
 * sides and was not the trade-off chosen for the referential. Their typographic
 * variants are unified, though — that is a different question, see
 * docs/decisions.md (2026-08-02).
 */
export const normalizeCommuneName = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // é è ô ÿ ç … → base letter
    .replace(/œ/g, 'oe') // NFD leaves ligatures alone: Œuilly, Cricquebœuf
    .replace(/æ/g, 'ae')
    // Phone keyboards type ’ where the COG stores ': L’Isle-Adam, L’Aigle.
    .replace(/[’ʼ]/gu, "'");
