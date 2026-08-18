import { toIsoDate, type IsoDate } from '@mon-sinistre/contracts';
import type { DurationUnit } from 'src/generated/prisma/enums';

/**
 * Adds a `DeadlineRule`'s duration to an anchor date. UTC calendar
 * arithmetic, not local time: `IsoDate` carries no timezone
 * (packages/contracts/src/iso-date.ts), so the result must not depend on the
 * server's.
 *
 * `MONTHS` overflow is JS `Date`'s own normalization, not clamping — 31
 * January + 1 month rolls into 3 March, since February has no 31st. No rule
 * in the seed uses `MONTHS` yet (docs/research/jorf-monitor.md,
 * "DeadlineRule: срок déclaration"); documented so a future one does not
 * trip over it silently.
 */
export function resolveDeadline(
  anchor: IsoDate,
  duration: number,
  unit: DurationUnit,
): IsoDate {
  const date = new Date(`${anchor}T00:00:00Z`);
  if (unit === 'MONTHS') {
    date.setUTCMonth(date.getUTCMonth() + duration);
  } else {
    date.setUTCDate(date.getUTCDate() + duration);
  }
  return toIsoDate(date.toISOString().slice(0, 10));
}
