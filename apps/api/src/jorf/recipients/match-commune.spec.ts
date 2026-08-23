import { normalizeCommuneName } from '../../communes/normalize-commune-name';
import { CommuneReferentialEntry, matchCommune } from './match-commune';

function entry(
  overrides: Partial<CommuneReferentialEntry> & {
    name: string;
    departementName?: string;
  },
): CommuneReferentialEntry {
  const { name, departementName, ...rest } = overrides;
  return {
    codeInsee: '00000',
    nameNormalized: normalizeCommuneName(name),
    departementNameNormalized: normalizeCommuneName(departementName ?? 'Gard'),
    effectiveTo: null,
    ...rest,
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

  describe('the postpositioned article of an annexe label', () => {
    const communes = [
      entry({
        name: 'Les Lucs-sur-Boulogne',
        codeInsee: '85129',
        departementName: 'Vendée',
      }),
      entry({ name: 'Le Pouzin', codeInsee: '07181', departementName: 'Ardèche' }),
      entry({
        name: "La Cadière-d'Azur",
        codeInsee: '83034',
        departementName: 'Var',
      }),
      entry({
        name: "L'Escarène",
        codeInsee: '06057',
        departementName: 'Alpes-Maritimes',
      }),
      entry({ name: 'Faux', codeInsee: '08165', departementName: 'Ardennes' }),
    ];

    it('is moved back to the front, with no space after the elided article', () => {
      expect(matchCommune(communes, 'Lucs-sur-Boulogne (Les)', 'Vendée')).toBe(
        '85129',
      );
      expect(matchCommune(communes, 'Pouzin (Le)', 'Ardèche')).toBe('07181');
      expect(matchCommune(communes, "Cadière-d'Azur (La)", 'Var')).toBe('83034');
      expect(matchCommune(communes, "Escarène (L')", 'Alpes-Maritimes')).toBe(
        '06057',
      );
    });

    it('leaves a label that already reads in COG order alone', () => {
      expect(matchCommune(communes, 'Le Pouzin', 'Ardèche')).toBe('07181');
      expect(matchCommune(communes, 'Faux', 'Ardennes')).toBe('08165');
    });

    it('is not invented for a commune that has none', () => {
      expect(matchCommune(communes, 'Faux (Le)', 'Ardennes')).toBeNull();
    });

    it('does not confuse two communes sharing a name in different départements', () => {
      const bothColombes = [
        entry({
          name: 'La Colombe',
          codeInsee: '41051',
          departementName: 'Loir-et-Cher',
        }),
        entry({
          name: 'La Colombe',
          codeInsee: '50127',
          departementName: 'Manche',
        }),
      ];

      expect(matchCommune(bothColombes, 'Colombe (La)', 'Manche')).toBe('50127');
    });
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
