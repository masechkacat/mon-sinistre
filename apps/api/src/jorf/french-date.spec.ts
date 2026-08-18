import { parseFrenchDate } from './french-date';

describe('parseFrenchDate', () => {
  it('converts a DD/MM/YYYY annexe date cell to IsoDate', () => {
    expect(parseFrenchDate('01/01/2025')).toBe('2025-01-01');
    expect(parseFrenchDate('31/12/2025')).toBe('2025-12-31');
  });

  it('throws on a value that is not DD/MM/YYYY', () => {
    expect(() => parseFrenchDate('2025-01-01')).toThrow();
    expect(() => parseFrenchDate('')).toThrow();
  });

  it('throws on a date that does not exist', () => {
    expect(() => parseFrenchDate('30/02/2025')).toThrow();
  });
});
