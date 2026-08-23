import { isIsoDate } from '@mon-sinistre/contracts';
import { todayInParis } from './today-in-paris';

describe('todayInParis', () => {
  it('returns the Paris calendar date, not the UTC one, past midnight in CEST (summer, UTC+2)', () => {
    expect(todayInParis(new Date('2026-08-23T23:30:00Z'))).toBe('2026-08-24');
  });

  it('returns the Paris calendar date, not the UTC one, past midnight in CET (winter, UTC+1)', () => {
    expect(todayInParis(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });

  it('agrees with UTC well before midnight', () => {
    expect(todayInParis(new Date('2026-08-23T12:00:00Z'))).toBe('2026-08-23');
  });

  it('defaults to the real clock and returns a real calendar date', () => {
    expect(isIsoDate(todayInParis())).toBe(true);
  });
});
