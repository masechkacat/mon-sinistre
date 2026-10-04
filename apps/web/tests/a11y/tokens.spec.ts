import { expect, test } from '@playwright/test';
import { contrastRatio, roles } from '../support/contrast';
import { sourceFiles } from '../support/sources';

const sheetRoles = [
  'papier',
  'encre',
  'secondaire',
  'filet',
  'vermillon',
  'petrole',
] as const;

const lightRoles = ['fond', ...sheetRoles] as const;

// The "sur fond" roles of the dark theme: what lies directly on the dark
// ground. `vermillon-sur-fond` is the one the sheet did not foresee — field
// errors sit on the ground, and the sheet's vermillon measures 2.6:1 there.
const darkRoles = [
  'texte-sur-fond',
  'secondaire-sur-fond',
  'filet-sur-fond',
  'vermillon-sur-fond',
] as const;

// The pairs of the design sheet: an ink (or rule) role over a surface role.
// Contrast is symmetric, so the sheet's "papier label on petrole" and "petrole
// link on papier" are one pair, checked once.
const pairs = [
  { theme: 'light', a: 'encre', b: 'papier', min: 4.5 },
  { theme: 'light', a: 'secondaire', b: 'papier', min: 4.5 },
  { theme: 'light', a: 'vermillon', b: 'papier', min: 4.5 },
  { theme: 'light', a: 'petrole', b: 'papier', min: 4.5 },
  { theme: 'light', a: 'encre', b: 'fond', min: 4.5 },
  { theme: 'light', a: 'petrole', b: 'fond', min: 4.5 },
  { theme: 'dark', a: 'texte-sur-fond', b: 'fond', min: 4.5 },
  { theme: 'dark', a: 'secondaire-sur-fond', b: 'fond', min: 4.5 },
  { theme: 'dark', a: 'vermillon-sur-fond', b: 'fond', min: 4.5 },
  // Field and paper-button boundaries on the dark ground (WCAG 1.4.11).
  { theme: 'dark', a: 'filet', b: 'fond', min: 3 },
] as const;

test('globals.css declares the roles of the design system and no eighth one', () => {
  const { light, dark } = roles();
  expect(Object.keys(light).sort()).toEqual([...lightRoles].sort());
  expect(Object.keys(dark).sort()).toEqual(
    [...lightRoles, ...darkRoles].sort(),
  );
});

test('the sheet keeps its values in the dark theme', () => {
  const { light, dark } = roles();
  for (const role of sheetRoles) {
    expect(dark[role], role).toBe(light[role]);
  }
});

for (const { theme, a, b, min } of pairs) {
  test(`${theme}: ${a} on ${b} stays above ${min}:1`, () => {
    const palette = roles()[theme];
    expect(contrastRatio(palette[a], palette[b])).toBeGreaterThanOrEqual(min);
  });
}

test('no source file outside the roles carries a colour literal', () => {
  const roleDeclaration = new RegExp(
    `^\\s*--(${[...lightRoles, ...darkRoles].join('|')}):\\s*#[0-9a-f]{6};$`,
    'i',
  );
  const literal = /#[0-9a-f]{3,8}\b|\bblack\b|\bwhite\b/i;
  const offenders = sourceFiles().flatMap(({ path, text }) =>
    text
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => literal.test(line) && !roleDeclaration.test(line))
      .map(({ line, number }) => `${path}:${number}: ${line.trim()}`),
  );
  expect(offenders).toEqual([]);
});
