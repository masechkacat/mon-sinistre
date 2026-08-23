import { toIsoDate } from '@mon-sinistre/contracts';
import { toSourceReference } from './source-reference';

describe('toSourceReference', () => {
  it('carries the url and verifiedAt through unchanged', () => {
    const ref = toSourceReference(
      'https://legifrance.gouv.fr/x',
      toIsoDate('2026-01-23'),
      toIsoDate('2026-01-23'),
    );
    expect(ref.url).toBe('https://legifrance.gouv.fr/x');
    expect(ref.verifiedAt).toBe('2026-01-23');
  });

  it('is not possiblyOutdated exactly six months after verification', () => {
    const ref = toSourceReference(
      'https://legifrance.gouv.fr/x',
      toIsoDate('2026-01-23'),
      toIsoDate('2026-07-23'),
    );
    expect(ref.possiblyOutdated).toBe(false);
  });

  it('is possiblyOutdated the day after the six-month mark', () => {
    const ref = toSourceReference(
      'https://legifrance.gouv.fr/x',
      toIsoDate('2026-01-23'),
      toIsoDate('2026-07-24'),
    );
    expect(ref.possiblyOutdated).toBe(true);
  });

  it('clamps a six-month-ago 31 August to a real end-of-month day, not possiblyOutdated on that day', () => {
    // 2025-08-31 + 6 months has no 31 February; resolveDeadline clamps to 28.
    const ref = toSourceReference(
      'https://legifrance.gouv.fr/x',
      toIsoDate('2025-08-31'),
      toIsoDate('2026-02-28'),
    );
    expect(ref.possiblyOutdated).toBe(false);
  });

  it('is possiblyOutdated the day after that clamped end-of-month mark', () => {
    const ref = toSourceReference(
      'https://legifrance.gouv.fr/x',
      toIsoDate('2025-08-31'),
      toIsoDate('2026-03-01'),
    );
    expect(ref.possiblyOutdated).toBe(true);
  });
});
