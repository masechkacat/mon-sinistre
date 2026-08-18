import { normalizeCommuneName } from './normalize-commune-name';

const SOURCE = {
  sourceUrl: 'https://geo.api.gouv.fr/communes',
  sourceVerifiedAt: new Date('2026-08-02'),
};

/** A full `Commune` row fixture — `nameNormalized` derived here exactly as the import derives it, so a fixture typo can't hide a mismatch between the two. */
export const commune = (
  codeInsee: string,
  name: string,
  departementCode: string,
  departementName: string,
  effectiveTo: string | null = null,
) => ({
  codeInsee,
  name,
  nameNormalized: normalizeCommuneName(name),
  departementCode,
  departementName,
  effectiveTo: effectiveTo === null ? null : new Date(effectiveTo),
  ...SOURCE,
});
