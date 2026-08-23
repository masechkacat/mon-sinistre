import { toIsoDate, type IsoDate } from '@mon-sinistre/contracts';

const PARIS_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Same timezone as the monitor's own `@Cron` schedule
 * (docs/research/sinistre-plan.md, "Статусы шагов на чтении и «сегодня» в
 * Europe/Paris"). `now` defaults to the real clock and is only ever
 * overridden by tests.
 */
export function todayInParis(now: Date = new Date()): IsoDate {
  const parts = PARIS_DATE_FORMAT.formatToParts(now);
  const value = (type: 'year' | 'month' | 'day') =>
    parts.find((part) => part.type === type)?.value;
  return toIsoDate(`${value('year')}-${value('month')}-${value('day')}`);
}
