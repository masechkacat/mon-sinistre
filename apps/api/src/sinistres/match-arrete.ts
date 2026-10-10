import type { IsoDate } from '@mon-sinistre/contracts';
import { loadSuccessorMap } from 'src/communes/load-successor-map';
import {
  dateToIsoDate,
  isoDateToDate,
} from 'src/deadline-rules/resolve-deadline';
import type { ArreteEntryOutcome } from 'src/generated/prisma/enums';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  matchSinistres,
  toMatchArreteEntry,
  type MatchCandidateSinistre,
} from './match-sinistres';

/** The matched entry's fields a caller needs to date and status a plan. */
export interface MatchedArrete {
  arreteEntryId: string;
  outcome: ArreteEntryOutcome;
  publishedAt: IsoDate;
}

/**
 * Matches a sinistre that does not exist yet against already-ingested arrêtés
 * through the shared pure {@link matchSinistres} — the same function the
 * monitor's own linking pass (docs/plan/sinistre-plan.md, Фаза 3) will call
 * for already-created dossiers, so the two never disagree on what counts as a
 * match. The candidate carries a placeholder id: `matchSinistres` only echoes
 * it back on the `Link` it returns, and there is exactly one candidate here,
 * so the id itself is never read. Reads only; whether the match is persisted
 * is the caller's business.
 */
export async function matchArreteFor(
  prisma: Pick<PrismaService, 'arreteEntry' | 'commune'>,
  candidate: Omit<MatchCandidateSinistre, 'id'>,
): Promise<MatchedArrete | null> {
  const eventDate = isoDateToDate(candidate.eventDate);
  const [entries, successorOf] = await Promise.all([
    prisma.arreteEntry.findMany({
      where: {
        codeInsee: { not: null },
        eventStart: { lte: eventDate },
        eventEnd: { gte: eventDate },
      },
      select: {
        id: true,
        codeInsee: true,
        risque: true,
        eventStart: true,
        eventEnd: true,
        outcome: true,
        arrete: { select: { publishedAt: true } },
      },
    }),
    loadSuccessorMap(prisma),
  ]);

  const links = matchSinistres(
    entries.map(toMatchArreteEntry),
    [{ id: 'candidate', ...candidate }],
    successorOf,
  );
  const arreteEntryId = links[0]?.arreteEntryId;
  if (!arreteEntryId) {
    return null;
  }
  const entry = entries.find((e) => e.id === arreteEntryId);
  if (!entry) {
    return null;
  }
  return {
    arreteEntryId,
    outcome: entry.outcome,
    publishedAt: dateToIsoDate(entry.arrete.publishedAt),
  };
}
