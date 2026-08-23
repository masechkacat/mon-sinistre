import { SinistreStatus, type IsoDate } from '@mon-sinistre/contracts';
import type { ArreteEntryOutcome } from 'src/generated/prisma/enums';

/** The one fact `sinistreStatus` needs off a linked `ArreteEntry`. */
export interface SinistreLink {
  outcome: ArreteEntryOutcome;
}

export interface SinistreStatusInput {
  /** Status on the row now; `null` for a sinistre being created. */
  current: SinistreStatus | null;
  link: SinistreLink | null;
  declarationDate: IsoDate | null;
}

/**
 * The single place a `Sinistre.status` is decided
 * (docs/research/sinistre-plan.md, «Контракт API») — called both by this
 * PATCH and, from Фаза 3 onward, by the arrêté-linking code, so the two
 * never disagree on what a given (link, declarationDate) pair means.
 */
export function sinistreStatus({
  current,
  link,
  declarationDate,
}: SinistreStatusInput): SinistreStatus {
  if (
    current === SinistreStatus.CLOS ||
    current === SinistreStatus.SANS_SUITE
  ) {
    return current;
  }
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
