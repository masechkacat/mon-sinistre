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

  // Overflow behaviour explained in resolveDeadline's docblock.
  it('rolls a month-end overflow into the next month', () => {
    expect(resolveDeadline(toIsoDate('2026-01-31'), 1, 'MONTHS')).toBe(
      '2026-03-03',
    );
  });
});
