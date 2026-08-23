import { SinistreStatus, toIsoDate } from '@mon-sinistre/contracts';
import { sinistreStatus } from './sinistre-status';

describe('sinistreStatus', () => {
  it('gives DECLARE once a declaration date is set, regardless of the link', () => {
    expect(sinistreStatus(null, toIsoDate('2026-07-10'))).toBe(
      SinistreStatus.DECLARE,
    );
    expect(
      sinistreStatus({ outcome: 'RECONNU' }, toIsoDate('2026-07-10')),
    ).toBe(SinistreStatus.DECLARE);
  });

  it('gives AVANT_ARRETE for an unlinked sinistre without a declaration date', () => {
    expect(sinistreStatus(null, null)).toBe(SinistreStatus.AVANT_ARRETE);
  });

  it('gives ARRETE_PUBLIE for a sinistre linked to a RECONNU entry without a declaration date', () => {
    expect(sinistreStatus({ outcome: 'RECONNU' }, null)).toBe(
      SinistreStatus.ARRETE_PUBLIE,
    );
  });

  it('gives ARRETE_REFUSE for a sinistre linked to a REFUSE entry without a declaration date', () => {
    expect(sinistreStatus({ outcome: 'REFUSE' }, null)).toBe(
      SinistreStatus.ARRETE_REFUSE,
    );
  });
});
