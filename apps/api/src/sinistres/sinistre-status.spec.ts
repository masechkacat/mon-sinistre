import { SinistreStatus, toIsoDate } from '@mon-sinistre/contracts';
import { sinistreStatus } from './sinistre-status';

describe('sinistreStatus', () => {
  it('gives DECLARE once a declaration date is set, regardless of the link', () => {
    expect(
      sinistreStatus({
        current: SinistreStatus.AVANT_ARRETE,
        link: null,
        declarationDate: toIsoDate('2026-07-10'),
      }),
    ).toBe(SinistreStatus.DECLARE);
    expect(
      sinistreStatus({
        current: SinistreStatus.ARRETE_PUBLIE,
        link: { outcome: 'RECONNU' },
        declarationDate: toIsoDate('2026-07-10'),
      }),
    ).toBe(SinistreStatus.DECLARE);
  });

  it('gives AVANT_ARRETE for an unlinked sinistre without a declaration date', () => {
    expect(
      sinistreStatus({ current: null, link: null, declarationDate: null }),
    ).toBe(SinistreStatus.AVANT_ARRETE);
  });

  it('gives ARRETE_PUBLIE for a sinistre linked to a RECONNU entry without a declaration date', () => {
    expect(
      sinistreStatus({
        current: SinistreStatus.AVANT_ARRETE,
        link: { outcome: 'RECONNU' },
        declarationDate: null,
      }),
    ).toBe(SinistreStatus.ARRETE_PUBLIE);
  });

  it('gives ARRETE_REFUSE for a sinistre linked to a REFUSE entry without a declaration date', () => {
    expect(
      sinistreStatus({
        current: SinistreStatus.AVANT_ARRETE,
        link: { outcome: 'REFUSE' },
        declarationDate: null,
      }),
    ).toBe(SinistreStatus.ARRETE_REFUSE);
  });

  it.each([SinistreStatus.CLOS, SinistreStatus.SANS_SUITE])(
    'keeps %s: a closed dossier is not dragged back by a declaration date or a link',
    (current) => {
      expect(
        sinistreStatus({
          current,
          link: null,
          declarationDate: toIsoDate('2026-07-10'),
        }),
      ).toBe(current);
      expect(
        sinistreStatus({
          current,
          link: { outcome: 'RECONNU' },
          declarationDate: null,
        }),
      ).toBe(current);
    },
  );
});
