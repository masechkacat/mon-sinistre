import {
  REFERENCE_DATA_STALE_AFTER_MONTHS,
  type IsoDate,
  type SourceReference,
} from '@mon-sinistre/contracts';
import { resolveDeadline } from 'src/deadline-rules/resolve-deadline';

/**
 * Builds a `SourceReference`, resolving `possiblyOutdated` the one way it is
 * computed in the project: the same calendar arithmetic (month-end clamping
 * included) that turns a `DeadlineRule` into a deadline, so "31 August" does
 * not get two different answers depending on which code path asks
 * (docs/research/sinistre-plan.md, "`SourceReference` и `possiblyOutdated`").
 */
export function toSourceReference(
  url: string,
  verifiedAt: IsoDate,
  today: IsoDate,
): SourceReference {
  return {
    url,
    verifiedAt,
    possiblyOutdated:
      resolveDeadline(verifiedAt, REFERENCE_DATA_STALE_AFTER_MONTHS, 'MONTHS') <
      today,
  };
}
