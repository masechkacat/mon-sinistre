// Covers the password validator from @mon-sinistre/contracts: that package
// has no test runner of its own — per the monorepo convention all tests live
// here, and jest resolves contracts straight from its sources
// (moduleNameMapper).
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_CHAR_CLASSES,
  PASSWORD_MIN_LENGTH,
  isValidPassword,
} from '@mon-sinistre/contracts';

describe('isValidPassword', () => {
  it('accepts a password with 3 of 4 categories at the minimum length', () => {
    expect(isValidPassword('Abc12345')).toBe(true);
  });

  it('rejects a password with only 2 categories (lowercase + digit)', () => {
    expect(isValidPassword('abc12345')).toBe(false);
  });

  it(`rejects a password shorter than ${PASSWORD_MIN_LENGTH} characters`, () => {
    expect(isValidPassword('Abc1234')).toBe(false);
  });

  it(`rejects a password longer than ${PASSWORD_MAX_BYTES} UTF-8 bytes, even under that many characters`, () => {
    // 'Abc12345' alone already covers 3 categories; 'é' is 2 bytes in UTF-8,
    // so 33 of them push the byte count to 74 while the character count (41)
    // stays well under the byte limit — isolates the byte check from length.
    const password = 'Abc12345' + 'é'.repeat(33);
    expect(password.length).toBeLessThan(PASSWORD_MAX_BYTES);
    expect(isValidPassword(password)).toBe(false);
  });

  it(`requires at least ${PASSWORD_MIN_CHAR_CLASSES} of the 4 character categories`, () => {
    expect(isValidPassword('abcdefgh')).toBe(false); // lowercase only
    expect(isValidPassword('12345678')).toBe(false); // digits only
    expect(isValidPassword('Abcdefg!')).toBe(true); // upper + lower + special
  });
});
