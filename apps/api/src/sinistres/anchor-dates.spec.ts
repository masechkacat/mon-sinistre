import { toIsoDate } from '@mon-sinistre/contracts';
import { anchorDatesOf } from './anchor-dates';

describe('anchorDatesOf', () => {
  it('always resolves DATE_SINISTRE to the event date', () => {
    const dates = anchorDatesOf({
      eventDate: toIsoDate('2026-06-01'),
      declarationDate: null,
      arretePublishedAt: null,
    });
    expect(dates.DATE_SINISTRE).toBe('2026-06-01');
  });

  it('leaves DATE_PUBLICATION_ARRETE and DATE_DECLARATION unresolved before any arrêté and any declaration', () => {
    const dates = anchorDatesOf({
      eventDate: toIsoDate('2026-06-01'),
      declarationDate: null,
      arretePublishedAt: null,
    });
    expect(dates.DATE_PUBLICATION_ARRETE).toBeUndefined();
    expect(dates.DATE_DECLARATION).toBeUndefined();
  });

  it('never emits a date for the three insurer anchors the product does not store', () => {
    const dates = anchorDatesOf({
      eventDate: toIsoDate('2026-06-01'),
      declarationDate: toIsoDate('2026-07-05'),
      arretePublishedAt: toIsoDate('2026-07-01'),
    });
    expect(dates.DATE_ETAT_ESTIMATIF).toBeUndefined();
    expect(dates.DATE_ETAT_ESTIMATIF_OU_EXPERTISE).toBeUndefined();
    expect(dates.DATE_ACCORD_INDEMNISATION).toBeUndefined();
  });

  it('anchors DATE_DECLARATION on the publication date when the declaration came first', () => {
    const dates = anchorDatesOf({
      eventDate: toIsoDate('2026-06-01'),
      declarationDate: toIsoDate('2026-06-05'),
      arretePublishedAt: toIsoDate('2026-07-01'),
    });
    expect(dates.DATE_DECLARATION).toBe('2026-07-01');
  });

  it('anchors DATE_DECLARATION on the declaration date when it came after publication', () => {
    const dates = anchorDatesOf({
      eventDate: toIsoDate('2026-06-01'),
      declarationDate: toIsoDate('2026-07-20'),
      arretePublishedAt: toIsoDate('2026-07-01'),
    });
    expect(dates.DATE_DECLARATION).toBe('2026-07-20');
  });

  it('leaves DATE_DECLARATION unresolved when no declaration was made yet, even with a published arrêté', () => {
    const dates = anchorDatesOf({
      eventDate: toIsoDate('2026-06-01'),
      declarationDate: null,
      arretePublishedAt: toIsoDate('2026-07-01'),
    });
    expect(dates.DATE_DECLARATION).toBeUndefined();
  });

  it('leaves DATE_DECLARATION unresolved when declared but no arrêté is published yet', () => {
    const dates = anchorDatesOf({
      eventDate: toIsoDate('2026-06-01'),
      declarationDate: toIsoDate('2026-06-10'),
      arretePublishedAt: null,
    });
    expect(dates.DATE_DECLARATION).toBeUndefined();
  });
});
