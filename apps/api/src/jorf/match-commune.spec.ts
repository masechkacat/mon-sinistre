import { normalizeCommuneName } from '../communes/normalize-commune-name';
import { CommuneReferentialEntry, matchCommune } from './match-commune';

function entry(
  overrides: Partial<CommuneReferentialEntry> & { name: string },
): CommuneReferentialEntry {
  return {
    codeInsee: '00000',
    nameNormalized: normalizeCommuneName(overrides.name),
    departementName: 'Gard',
    effectiveTo: null,
    ...overrides,
  };
}

describe('matchCommune', () => {
  it('matches regardless of diacritics and case in the annexe label', () => {
    const communes = [
      entry({ name: 'Nîmes', codeInsee: '30189', departementName: 'Gard' }),
    ];

    expect(matchCommune(communes, 'NIMES', 'gard')).toBe('30189');
    expect(matchCommune(communes, 'Nîmes', 'GARD')).toBe('30189');
  });

  it('falls back to a superseded row when no current row matches', () => {
    const communes = [
      entry({
        name: 'Ancienne-Commune',
        codeInsee: '30001',
        departementName: 'Gard',
        effectiveTo: new Date('2020-01-01'),
      }),
    ];

    expect(matchCommune(communes, 'Ancienne-Commune', 'Gard')).toBe('30001');
  });

  it('prefers the current row over a superseded one of the same name and département', () => {
    const communes = [
      entry({
        name: 'Renommée',
        codeInsee: 'old01',
        departementName: 'Gard',
        effectiveTo: new Date('2020-01-01'),
      }),
      entry({
        name: 'Renommée',
        codeInsee: 'new01',
        departementName: 'Gard',
        effectiveTo: null,
      }),
    ];

    expect(matchCommune(communes, 'Renommée', 'Gard')).toBe('new01');
  });

  it('does not confuse two communes sharing a name in different départements', () => {
    const communes = [
      entry({
        name: 'Sainte-Colombe',
        codeInsee: '30300',
        departementName: 'Gard',
      }),
      entry({
        name: 'Sainte-Colombe',
        codeInsee: '69204',
        departementName: 'Rhône',
      }),
    ];

    expect(matchCommune(communes, 'Sainte-Colombe', 'Rhône')).toBe('69204');
    expect(matchCommune(communes, 'Sainte-Colombe', 'Gard')).toBe('30300');
  });

  it('gives null for an unknown commune', () => {
    const communes = [
      entry({ name: 'Nîmes', codeInsee: '30189', departementName: 'Gard' }),
    ];

    expect(matchCommune(communes, 'Commune Inconnue', 'Gard')).toBeNull();
  });

  it('gives null when the annexe label matches several rows ambiguously', () => {
    const communes = [
      entry({
        name: 'Doublon',
        codeInsee: '30001',
        departementName: 'Gard',
        effectiveTo: new Date('2019-01-01'),
      }),
      entry({
        name: 'Doublon',
        codeInsee: '30002',
        departementName: 'Gard',
        effectiveTo: new Date('2021-01-01'),
      }),
    ];

    expect(matchCommune(communes, 'Doublon', 'Gard')).toBeNull();
  });

  it('gives null for a row whose name was never normalized (pre-backfill)', () => {
    const communes = [
      entry({
        name: 'Nîmes',
        codeInsee: '30189',
        departementName: 'Gard',
        nameNormalized: null,
      }),
    ];

    expect(matchCommune(communes, 'Nîmes', 'Gard')).toBeNull();
  });
});
