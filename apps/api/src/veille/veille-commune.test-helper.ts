/** Shared by the veille int-specs, so none of them repeats its own copy. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal `Commune` row good enough for veille's FK on `VeilleCommune`. */
export const communeFixture = (codeInsee: string, name: string) => ({
  codeInsee,
  name,
  departementCode: codeInsee.slice(0, 2),
  departementName: 'Gard',
  sourceUrl: 'https://geo.api.gouv.fr/communes',
  sourceVerifiedAt: new Date('2026-08-16'),
});
