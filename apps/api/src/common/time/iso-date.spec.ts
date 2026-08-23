// Covers the IsoDate helpers from @mon-sinistre/contracts: that package has no
// test runner of its own — per the monorepo convention all tests live here,
// and jest resolves contracts straight from its sources (moduleNameMapper).
import { isIsoDate, toIsoDate } from '@mon-sinistre/contracts';

describe('isIsoDate', () => {
  it.each(['2026-07-30', '2026-01-01', '2026-12-31', '2024-02-29'])(
    'accepts the real calendar date %s',
    (value) => {
      expect(isIsoDate(value)).toBe(true);
    },
  );

  it.each([
    ['2026-02-29', 'February 29 of a non-leap year'],
    ['2026-02-30', 'a day that does not exist'],
    ['2026-13-01', 'a 13th month'],
    ['2026-00-10', 'a zero month'],
    ['2026-06-00', 'a zero day'],
  ])('rejects %s (%s)', (value) => {
    expect(isIsoDate(value)).toBe(false);
  });

  it.each([
    ['2026-7-30', 'missing zero padding'],
    ['30/07/2026', 'French date format'],
    ['2026-07-30T00:00:00Z', 'a timestamp'],
    ['20260730', 'no separators'],
    ['', 'an empty string'],
  ])('rejects %s (%s)', (value) => {
    expect(isIsoDate(value)).toBe(false);
  });
});

describe('toIsoDate', () => {
  it('returns the same string, branded', () => {
    expect(toIsoDate('2026-07-30')).toBe('2026-07-30');
  });

  it('throws on an invalid date and names the offending value', () => {
    expect(() => toIsoDate('2026-02-30')).toThrow(RangeError);
    expect(() => toIsoDate('2026-02-30')).toThrow('2026-02-30');
  });
});
