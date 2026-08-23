import { SinistreStatus, type IsoDate } from '@mon-sinistre/contracts';
import type { ArreteEntryOutcome } from 'src/generated/prisma/enums';

/** The one fact `sinistreStatus` needs off a linked `ArreteEntry`. */
export interface SinistreLink {
  outcome: ArreteEntryOutcome;
}

/**
 * The single place a `Sinistre.status` is decided
 * (docs/research/sinistre-plan.md, «Контракт API») — called both by this
 * PATCH and, from Фаза 3 onward, by the arrêté-linking code, so the two
 * never disagree on what a given (link, declarationDate) pair means.
 */
export function sinistreStatus(
  link: SinistreLink | null,
  declarationDate: IsoDate | null,
): SinistreStatus {
  if (declarationDate !== null) {
    return SinistreStatus.DECLARE;
  }
  if (link === null) {
    return SinistreStatus.AVANT_ARRETE;
  }
  return link.outcome === 'RECONNU'
    ? SinistreStatus.ARRETE_PUBLIE
    : SinistreStatus.ARRETE_REFUSE;
}
