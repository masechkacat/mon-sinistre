import {
  BACKFILL_START_DELTA,
  selectBackfillDeltas,
} from './select-backfill-deltas';

describe('selectBackfillDeltas', () => {
  it('drops deltas generated before the 2026 backfill boundary', () => {
    expect(
      selectBackfillDeltas([
        'JORFSIMPLE_20251231-230000.tar.gz',
        BACKFILL_START_DELTA,
        'JORFSIMPLE_20260101-230000.tar.gz',
        'JORFSIMPLE_20260613-060000.tar.gz',
      ]),
    ).toEqual([
      BACKFILL_START_DELTA,
      'JORFSIMPLE_20260101-230000.tar.gz',
      'JORFSIMPLE_20260613-060000.tar.gz',
    ]);
  });

  it('keeps the exact boundary delta', () => {
    expect(selectBackfillDeltas([BACKFILL_START_DELTA])).toEqual([
      BACKFILL_START_DELTA,
    ]);
  });

  it('returns nothing for a catalogue that only predates the boundary', () => {
    expect(selectBackfillDeltas(['JORFSIMPLE_20250713-060000.tar.gz'])).toEqual(
      [],
    );
  });

  it('preserves input order instead of re-sorting', () => {
    // listDeltas() already sorts ascending; this only has to not undo that.
    expect(
      selectBackfillDeltas([
        'JORFSIMPLE_20260613-060000.tar.gz',
        'JORFSIMPLE_20260101-230000.tar.gz',
      ]),
    ).toEqual([
      'JORFSIMPLE_20260613-060000.tar.gz',
      'JORFSIMPLE_20260101-230000.tar.gz',
    ]);
  });
});
