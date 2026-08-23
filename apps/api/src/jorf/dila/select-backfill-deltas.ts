import { toIsoDate, type IsoDate } from '@mon-sinistre/contracts';
import { deltaNameFor } from './dila.client';

/**
 * The 2026 backfill's declared start (docs/research/jorf-monitor.md,
 * "Бэкфилл с 01.01.2026") — the one date both floors below are expressed in
 * terms of, so the delta and the arrêté boundary can never drift apart.
 * `apps/api/scripts/jorf-backfill.ts` passes this straight to `run()` as
 * `minPublishedAt`.
 */
export const BACKFILL_MIN_PUBLISHED_AT: IsoDate = toIsoDate('2026-01-01');

/**
 * The first delta the 2026 backfill reads — deltas are timestamped in their
 * file name (`deltaNameFor`), so the date above doubles as the boundary a
 * plain string comparison can filter on.
 */
export const BACKFILL_START_DELTA = deltaNameFor(BACKFILL_MIN_PUBLISHED_AT);

/** Deltas in scope for the 2026 backfill, in whatever order they arrived — the catalogue also lists deltas from before the current Freemium regeneration, which the backfill has no business touching. */
export function selectBackfillDeltas(names: readonly string[]): string[] {
  return names.filter((name) => name >= BACKFILL_START_DELTA);
}
