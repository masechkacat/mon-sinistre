import { normalizeCommuneName } from './normalize-commune-name';

describe('normalizeCommuneName', () => {
  it.each([
    ['Château-Thierry', 'chateau-thierry'],
    ['Nîmes', 'nimes'],
    ['Bègles', 'begles'],
    ["L'Haÿ-les-Roses", "l'hay-les-roses"],
    ['Besançon', 'besancon'],
    ['Sainte-Foy-lès-Lyon', 'sainte-foy-les-lyon'],
  ])('strips the diacritics of %s', (input, expected) => {
    expect(normalizeCommuneName(input)).toBe(expected);
  });

  it.each(['CHÂTEAU-THIERRY', 'château-thierry', 'chÂTeau-thierry'])(
    'lowercases %s to the same form',
    (input) => {
      expect(normalizeCommuneName(input)).toBe('chateau-thierry');
    },
  );

  it.each([
    // NFD does not decompose these ligatures, hence the explicit replacements.
    ['Œuilly', 'oeuilly'],
    ['Cricquebœuf', 'cricqueboeuf'],
    ['Bœrsch', 'boersch'],
    // No French commune spells æ today, but the referential is the source's
    // to change, and the rule costs one replace.
    ['Ægidius', 'aegidius'],
    ['Tænia', 'taenia'],
  ])('expands the ligature in %s', (input, expected) => {
    expect(normalizeCommuneName(input)).toBe(expected);
  });

  it.each([
    // Accepted limitation (research): apostrophes and hyphens are kept as
    // separators, so "lhay" will not find "L'Haÿ-les-Roses".
    ["L'Abergement-Clémenciat", "l'abergement-clemenciat"],
    ['Saint-Étienne', 'saint-etienne'],
  ])('keeps the apostrophes and hyphens of %s', (input, expected) => {
    expect(normalizeCommuneName(input)).toBe(expected);
  });

  it.each([
    // …but their typographic variants are unified: phone keyboards substitute
    // ’ for the ' the COG stores.
    ['L’Isle-Adam', "l'isle-adam"],
    ['L’Haÿ-les-Roses', "l'hay-les-roses"],
    ['LʼAigle', "l'aigle"],
  ])('folds the typographic apostrophe of %s', (input, expected) => {
    expect(normalizeCommuneName(input)).toBe(expected);
  });

  it.each([
    'Château-Thierry',
    'Cricquebœuf',
    "L'Haÿ-les-Roses",
    'Besançon',
    '',
  ])(
    'is idempotent for %s — the write side and the query side agree',
    (input) => {
      const once = normalizeCommuneName(input);

      expect(normalizeCommuneName(once)).toBe(once);
    },
  );

  it('leaves an already normalized name untouched', () => {
    expect(normalizeCommuneName('paris')).toBe('paris');
  });

  it('returns an empty string unchanged', () => {
    expect(normalizeCommuneName('')).toBe('');
  });

  // Digits and spaces survive untouched. Note that the function lowercases
  // them too, so it is a key for names only: the INSEE branch of the search
  // compares the raw q against codeInsee, which the import stores verbatim
  // in uppercase (Corsica: 2A004).
  it('keeps digits and spaces', () => {
    expect(normalizeCommuneName('Les Trois-Îlets 2A')).toBe(
      'les trois-ilets 2a',
    );
  });

  it('recomposes nothing: a precomposed and a decomposed é give one result', () => {
    const precomposed = 'Sainte-Cécile';
    const decomposed = precomposed.normalize('NFD');

    expect(precomposed).not.toBe(decomposed);
    expect(normalizeCommuneName(decomposed)).toBe(
      normalizeCommuneName(precomposed),
    );
    expect(normalizeCommuneName(decomposed)).toBe('sainte-cecile');
  });
});
