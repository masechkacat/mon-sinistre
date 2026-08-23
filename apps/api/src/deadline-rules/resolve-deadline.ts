import { toIsoDate, type IsoDate } from '@mon-sinistre/contracts';
import type { DurationUnit } from 'src/generated/prisma/enums';

/** UTC calendar date of a `Date` as `IsoDate` — never local time, since `@db.Date` columns (`Arrete.publishedAt` and friends) carry none. The one conversion of this direction; {@link resolveDeadline} and `src/jorf/jorf-monitor.service.ts` both read `@db.Date` columns back off Prisma and need it. */
export const dateToIsoDate = (value: Date): IsoDate =>
  toIsoDate(value.toISOString().slice(0, 10));

/** UTC midnight of an `IsoDate`, the reverse of {@link dateToIsoDate} — the one conversion callers needing date arithmetic on an `IsoDate` use, instead of each spelling out the `T00:00:00Z` parse themselves. */
export const isoDateToDate = (value: IsoDate): Date =>
  new Date(`${value}T00:00:00Z`);

/** Days in the UTC month a `Date` points at — day 0 of the next month is the last day of this one. */
const daysInUtcMonth = (date: Date): number =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();

/**
 * Adds a `DeadlineRule`'s duration to an anchor date. UTC calendar
 * arithmetic, not local time: `IsoDate` carries no timezone
 * (packages/contracts/src/iso-date.ts), so the result must not depend on the
 * server's.
 *
 * `MONTHS` clamps a month-end overflow to the last day of the target month
 * (31 January + 1 month → 28 February), the « quantième » rule of art. 641
 * CPC. JS `Date`'s own normalization would roll it forward to 3 March
 * instead — a *later*, less conservative deadline than the law gives, and
 * the project applies the more conservative value when sources disagree
 * (CLAUDE.md, "Жёсткие ограничения"). Setting the day to 1 before the
 * month moves is what keeps that normalization from firing.
 */
export function resolveDeadline(
  anchor: IsoDate,
  duration: number,
  unit: DurationUnit,
): IsoDate {
  const date = isoDateToDate(anchor);
  if (unit === 'MONTHS') {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + duration);
    date.setUTCDate(Math.min(day, daysInUtcMonth(date)));
  } else {
    date.setUTCDate(date.getUTCDate() + duration);
  }
  return dateToIsoDate(date);
}
