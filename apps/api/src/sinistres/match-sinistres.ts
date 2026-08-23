import type { IsoDate, RisqueCatnat } from '@mon-sinistre/contracts';
import { dateToIsoDate } from 'src/deadline-rules/resolve-deadline';
import type { ArreteEntryOutcome } from 'src/generated/prisma/enums';
import { classifyRisques } from 'src/jorf/parse/classify-risques';
import { resolveCurrentCode } from 'src/jorf/recipients/resolve-recipients';

/** The `ArreteEntry` fields `matchSinistres` needs, independent of caller. */
export interface MatchArreteEntry {
  id: string;
  /** null = annexe commune unmapped — never matches. */
  codeInsee: string | null;
  /** Raw JO wording, fed to `classifyRisques`. */
  risque: string;
  eventStart: IsoDate;
  eventEnd: IsoDate;
  outcome: ArreteEntryOutcome;
  /** `arreteEntry.arrete.publishedAt` — breaks ties among several RECONNU entries. */
  publishedAt: IsoDate;
}

/** The `ArreteEntry` row shape (Prisma `Date` columns, nested `arrete`) both
 * `SinistresService.matchArrete` and `JorfMonitorService.linkSinistres` read
 * off the database before calling `matchSinistres`. */
export interface MatchArreteEntryRow {
  id: string;
  codeInsee: string | null;
  risque: string;
  eventStart: Date;
  eventEnd: Date;
  outcome: ArreteEntryOutcome;
  arrete: { publishedAt: Date };
}

/** The one `Date` → `IsoDate` adapter from a queried `ArreteEntry` row to
 * {@link MatchArreteEntry} — both callers built the identical `.map()`
 * before this existed. */
export function toMatchArreteEntry(row: MatchArreteEntryRow): MatchArreteEntry {
  return {
    id: row.id,
    codeInsee: row.codeInsee,
    risque: row.risque,
    eventStart: dateToIsoDate(row.eventStart),
    eventEnd: dateToIsoDate(row.eventEnd),
    outcome: row.outcome,
    publishedAt: dateToIsoDate(row.arrete.publishedAt),
  };
}

/**
 * The `Sinistre` fields `matchSinistres` needs. Callers query only the
 * candidates the research calls out — unlinked, plus linked to `ARRETE_REFUSE`
 * (docs/research/sinistre-plan.md, "Привязка entry ↔ синистр") — this
 * function does not re-check that filter.
 */
export interface MatchCandidateSinistre {
  id: string;
  codeInsee: string;
  risque: RisqueCatnat;
  eventDate: IsoDate;
}

export interface SinistreArreteLink {
  sinistreId: string;
  arreteEntryId: string;
}

/** True when `candidate` should replace `current` as a sinistre's match. */
function beatsCurrentWinner(
  candidate: MatchArreteEntry,
  current: MatchArreteEntry,
): boolean {
  if (candidate.outcome !== current.outcome) {
    return candidate.outcome === 'RECONNU';
  }
  return candidate.publishedAt < current.publishedAt;
}

/**
 * Matches arrêté entries to sinistres of the same commune (through forward
 * successor resolve on both sides), the same `RisqueCatnat` (through
 * `classifyRisques`) and an event date inside the entry's period
 * (docs/research/sinistre-plan.md, "Привязка entry ↔ синистр"). Pure — three
 * callers apply the result: `SinistresService.create`, and `JorfMonitorService`
 * on ingest and on `applyRectificatif`.
 */
export function matchSinistres(
  entries: readonly MatchArreteEntry[],
  sinistres: readonly MatchCandidateSinistre[],
  successorOf: ReadonlyMap<string, string>,
): SinistreArreteLink[] {
  const resolvedEntries = entries
    .map((entry) => ({
      entry,
      codeInsee:
        entry.codeInsee === null
          ? null
          : resolveCurrentCode(entry.codeInsee, successorOf),
      risques: classifyRisques(entry.risque),
    }))
    .filter(
      (
        resolved,
      ): resolved is {
        entry: MatchArreteEntry;
        codeInsee: string;
        risques: Set<RisqueCatnat>;
      } => resolved.codeInsee !== null,
    );

  const links: SinistreArreteLink[] = [];

  for (const sinistre of sinistres) {
    const sinistreCode = resolveCurrentCode(sinistre.codeInsee, successorOf);
    if (sinistreCode === null) {
      continue;
    }

    let winner: MatchArreteEntry | null = null;
    for (const { entry, codeInsee, risques } of resolvedEntries) {
      if (
        codeInsee !== sinistreCode ||
        !risques.has(sinistre.risque) ||
        entry.eventStart > sinistre.eventDate ||
        entry.eventEnd < sinistre.eventDate
      ) {
        continue;
      }
      if (winner === null || beatsCurrentWinner(entry, winner)) {
        winner = entry;
      }
    }

    if (winner !== null) {
      links.push({ sinistreId: sinistre.id, arreteEntryId: winner.id });
    }
  }

  return links;
}
