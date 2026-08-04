/**
 * Search key of a commune name: case- and accent-insensitive. The same function
 * fills `nameNormalized` at import time and normalizes the `q` of a query, so
 * the write side and the read side cannot drift apart.
 *
 * Apostrophes, hyphens and spaces are deliberately kept: "lhay" does not find
 * "L'Haÿ-les-Roses".
 */
export const normalizeCommuneName = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/œ/g, 'oe') // NFD leaves ligatures alone: Œuilly, Cricquebœuf
    .replace(/æ/g, 'ae')
    // Phone keyboards type ’ where the COG stores ': L’Isle-Adam, L’Aigle.
    .replace(/[’ʼ]/gu, "'");
