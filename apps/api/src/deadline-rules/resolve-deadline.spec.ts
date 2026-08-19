import { toIsoDate } from '@mon-sinistre/contracts';
import { resolveDeadline } from './resolve-deadline';

describe('resolveDeadline', () => {
  it('adds a number of days to the anchor date', () => {
    expect(resolveDeadline(toIsoDate('2026-06-12'), 30, 'DAYS')).toBe(
      '2026-07-12',
    );
  });

  it('crosses a year boundary', () => {
    expect(resolveDeadline(toIsoDate('2026-12-15'), 30, 'DAYS')).toBe(
      '2027-01-14',
    );
  });

  it('adds a number of months to the anchor date', () => {
    expect(resolveDeadline(toIsoDate('2026-01-10'), 2, 'MONTHS')).toBe(
      '2026-03-10',
    );
  });

  // Why clamping and not JS Date's roll-forward — resolveDeadline's docblock.
  it('clamps a month-end overflow to the last day of the target month', () => {
    expect(resolveDeadline(toIsoDate('2026-01-31'), 1, 'MONTHS')).toBe(
      '2026-02-28',
    );
  });

  it('clamps to 29 February in a leap year', () => {
    expect(resolveDeadline(toIsoDate('2028-01-31'), 1, 'MONTHS')).toBe(
      '2028-02-29',
    );
  });

  it('crosses a year boundary in months without drifting a day', () => {
    expect(resolveDeadline(toIsoDate('2026-10-31'), 4, 'MONTHS')).toBe(
      '2027-02-28',
    );
  });
});
