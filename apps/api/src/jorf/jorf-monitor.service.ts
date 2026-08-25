import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type {
  IsoDate,
  RisqueCatnat,
  SinistreStatus,
} from '@mon-sinistre/contracts';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { errorSummary, stackOf } from 'src/common/error-report';
import { loadSuccessorMap } from 'src/communes/load-successor-map';
import { normalizeCommuneName } from 'src/communes/normalize-commune-name';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service';
import { DECLARATION_ASSUREUR_CODE } from 'src/deadline-rules/deadline-rule.seed';
import { dateToIsoDate } from 'src/deadline-rules/resolve-deadline';
import type { Prisma } from 'src/generated/prisma/client';
import type {
  ArreteEntryOutcome,
  MonitorAlertKind,
  SinistreNotificationKind,
} from 'src/generated/prisma/enums';
import type { ComposeMailInput } from 'src/mail/mail-message';
import { MailService } from 'src/mail/mail.service';
import { isUniqueViolationOn } from 'src/prisma/prisma-error';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  type ResolvedDeadlineRule,
  resolveStepPlannedDate,
} from 'src/sinistres/build-step-snapshot';
import {
  matchSinistres,
  toMatchArreteEntry,
  type MatchArreteEntry,
  type MatchCandidateSinistre,
  type SinistreArreteLink,
} from 'src/sinistres/match-sinistres';
import { sinistreStatus } from 'src/sinistres/sinistre-status';
import { generateVeilleToken } from 'src/veille/veille-token';
import { DilaClient } from './dila/dila.client';
import { classifyRisques } from './parse/classify-risques';
import {
  type CommuneReferentialEntry,
  matchCommune,
} from './recipients/match-commune';
import {
  drainOutbox as runOutboxDrain,
  type OutboxAdapter,
  type PendingOutboxRow,
} from './mail/drain-outbox';
import {
  type MonitorAlertForMail,
  monitorAlertMailFor,
} from './mail/monitor-alert-mail';
import {
  type ParsedArrete,
  type ParsedArreteEntry,
  parseArreteXml,
} from './parse/parse-arrete';
import {
  type SubscribedCommune,
  resolveRecipients,
  subtractCoveredEntries,
} from './recipients/resolve-recipients';
import { selectCatnatTextIds } from './parse/select-catnat-texts';
import {
  type ArreteEntryForMail,
  type ArreteForMail,
  veilleArreteMailFor,
} from './mail/veille-arrete-mail';
import { sinistreArreteMailFor } from './mail/sinistre-arrete-mail';

export { NOTIFICATION_ATTEMPTS_BEFORE_ALERT } from './mail/drain-outbox';

const TOC_BASENAME_PATTERN = /^JORFCONT/;

/**
 * A cold start finds every delta the catalogue lists (two a day, 28 KB–18 MB
 * each), so one tick would try to download years of them in a row. The rest
 * is picked up by the following ticks, oldest first; loading history in bulk
 * is the backfill script's job, not the monitor's.
 */
export const MAX_DELTAS_PER_RUN = 8;

const INGEST_LOCK_NAME = 'jorf-monitor';

/**
 * Longer than one run can take ({@link MAX_DELTAS_PER_RUN} downloads capped
 * at 2 min each, plus ingest), so a live holder never loses the lease
 * mid-run — the backfill renews it on every iteration — while a crashed
 * holder blocks the other process for at most this long, well under the gap
 * between two scheduled ticks.
 */
const INGEST_LOCK_TTL_MS = 60 * 60 * 1000;

/**
 * Backfill-only knobs (docs/research/jorf-monitor.md, "Бэкфилл с
 * 01.01.2026") — all empty for the scheduled tick, which notifies, considers
 * every delta the catalogue lists and never skips an arrêté on its date.
 * `apps/api/scripts/jorf-backfill.ts` is the only caller that sets them.
 */
export type RunOptions = {
  /**
   * `false` suppresses the outbox write entirely — no `VeilleNotification`
   * row is created for anything the run ingests, so nothing is ever mailed
   * for it ({@link JorfMonitorService.queueNotifications}, the one place
   * this knob is honored). The backfill's «не отправляет ни одного письма»
   * holds by this construction, not by a date check.
   */
  notify?: boolean;
  /** Restricts which deltas this run may pick up, already filtered to the backfill's date boundary — `this.dila.listDeltas()` is not called at all when this is set. */
  deltaNames?: readonly string[];
  /**
   * An arrêté first seen with `publishedAt` older than this is skipped
   * instead of created. Guards a rectificatif inside an otherwise in-scope
   * delta whose NOR the backfill has not created yet: without the floor it
   * would be created with the corrected text's own `publishedAt`, which can
   * predate the backfill's declared start.
   */
  minPublishedAt?: IsoDate;
  /**
   * The ingest-lock owner the backfill script acquired before its loop —
   * {@link JorfMonitorService.acquireIngestLock}. A run under it renews that
   * lease instead of taking and releasing one of its own, so the lock spans
   * the whole backfill, not each iteration: released between iterations, a
   * scheduled tick could slip in and ingest the script's still-pending
   * deltas with notifications on.
   */
  lockOwner?: string;
};

/**
 * Prisma's 5 s default for an interactive transaction is sized for a handful
 * of statements: one arrêté carries up to ~720 annexe rows, and a first-seen
 * one whose communes the referential can't resolve writes an alert per row.
 */
const INGEST_TX_TIMEOUT_MS = 60_000;

/** UTC midnight of an `IsoDate`, for `@db.Date` columns — the Prisma client requires a full ISO-8601 `Date`, not a bare `YYYY-MM-DD` string. */
const isoDateToDate = (value: IsoDate): Date => new Date(`${value}T00:00:00Z`);

/**
 * The `Sinistre.findMany` candidate filter shared by {@link
 * JorfMonitorService.linkSinistres} (ingest) and {@link
 * JorfMonitorService.matchRectificatifEntries} (rectificatif second pass,
 * docs/plan/sinistre-plan.md, Фаза 5, issue #164) — "declaration deadline
 * still undated" rather than a status list, for the reason {@link
 * JorfMonitorService.linkSinistres}'s docblock gives: it is the one query
 * that also catches a `DeadlineRule` gap, not just unlinked and
 * `ARRETE_REFUSE` dossiers.
 */
const UNDATED_DECLARATION_STEP: Prisma.SinistreWhereInput = {
  steps: {
    some: {
      anchor: 'DATE_PUBLICATION_ARRETE',
      fromTemplate: true,
      plannedDate: null,
    },
  },
};

/** `monitorAlerts` comes along as the key {@link JorfMonitorService.alertIfUnmatched} deduplicates by: an alert already recorded for a commune must not be raised, nor emailed, again on every rectificatif that follows. */
type StoredArrete = Prisma.ArreteGetPayload<{
  include: { entries: true; monitorAlerts: { select: { detail: true } } };
}>;
type StoredEntry = StoredArrete['entries'][number];

/** A pending outbox row, reduced to what {@link JorfMonitorService.drainOutbox} needs to send it. */
type PendingNotification = {
  id: string;
  veilleId: string;
  arreteId: string;
  attempts: number;
};

/** A pending `SinistreNotification` row, same role as {@link PendingNotification} for the sinistre half of the outbox. */
type PendingSinistreNotification = {
  id: string;
  sinistreId: string;
  arreteId: string;
  attempts: number;
};

/** One watcher's address plus the plaintext unsubscribe token minted for this run's mail(s) — `null` once {@link JorfMonitorService.rotateUnsubscribeToken} finds the row gone. */
type Recipient = { email: string; unsubscribeToken: string };

/**
 * State the send step carries across both drains of one run
 * ({@link JorfMonitorService.runOnce}). `recipients` is a memo, not a
 * pre-computation: a token is minted on the first mail a watcher is actually
 * about to receive, and reused for every further mail of the same run — a
 * watcher with two pending rows must get the same link in both, since only
 * the hash is stored and rotating again would dead-end the first one
 * (ТЗ § 7). `attempted` is why the post-ingest drain is not a free retry of
 * what the pre-ingest one just failed to send: a failed row belongs to the
 * next run, and re-sending inside the same run would burn a second token on
 * it.
 */
type SendPass = {
  successorOf: ReadonlyMap<string, string>;
  recipients: Map<string, Recipient | null>;
  attempted: Set<string>;
};

/** The fields `ArreteEntry` create needs, minus `arreteId` — shared by the first-seen path (nested `entries: { create }`) and the rectificatif path (flat `arreteEntry.create`/`.update`). `codeInsee` is taken as an argument, not recomputed here, so the caller matches ({@link isSameEntry}) and writes with the exact same value. */
function entryData(
  entry: ParsedArreteEntry,
  codeInsee: string | null,
): Omit<Prisma.ArreteEntryUncheckedCreateInput, 'arreteId'> {
  return {
    codeInsee,
    communeLabelRaw: entry.communeLabelRaw,
    departementRaw: entry.departementRaw,
    risque: entry.risque,
    eventStart: isoDateToDate(entry.eventStart),
    eventEnd: isoDateToDate(entry.eventEnd),
    outcome: entry.outcome,
    motivation: entry.motivation,
  };
}

/** A parsed line reduced to {@link MatchArreteEntry}, the shape `matchSinistres`
 * takes — shared by {@link JorfMonitorService.recomputeLinkedSinistres} and
 * {@link JorfMonitorService.matchRectificatifEntries}: both build it off the
 * same `ParsedArreteEntry`, an already-known `id`/`codeInsee` and the
 * revision's `publishedAt`. */
function toMatchEntry(
  id: string,
  codeInsee: string | null,
  entry: ParsedArreteEntry,
  publishedAt: IsoDate,
): MatchArreteEntry {
  return {
    id,
    codeInsee,
    risque: entry.risque,
    eventStart: entry.eventStart,
    eventEnd: entry.eventEnd,
    outcome: entry.outcome,
    publishedAt,
  };
}

/**
 * Just enough of a matched `ArreteEntry` to resolve its déclaration rule and
 * apply its link — {@link JorfMonitorService.applyMatchedLinks}'s shared
 * shape for {@link JorfMonitorService.linkSinistres}'s raw query row and
 * {@link JorfMonitorService.matchRectificatifEntries}'s `MatchArreteEntry`,
 * which otherwise agree on every field but `publishedAt`'s type and the
 * presence of `arreteId`.
 */
interface LinkableEntry {
  id: string;
  arreteId: string;
  outcome: ArreteEntryOutcome;
  publishedAt: IsoDate;
}

/** A queried `Sinistre` row reduced to {@link MatchCandidateSinistre} —
 * shared by {@link JorfMonitorService.linkSinistres} and {@link
 * JorfMonitorService.matchRectificatifEntries}, the two callers that query
 * {@link UNDATED_DECLARATION_STEP} candidates before calling `matchSinistres`. */
function toMatchCandidate(sinistre: {
  id: string;
  codeInsee: string;
  risque: string;
  eventDate: Date;
}): MatchCandidateSinistre {
  return {
    id: sinistre.id,
    codeInsee: sinistre.codeInsee,
    risque: sinistre.risque as RisqueCatnat,
    eventDate: dateToIsoDate(sinistre.eventDate),
  };
}

/**
 * The identity a commune line keeps across a rectificatif — `outcome` is
 * deliberately excluded: it is exactly the field a rectificatif may flip, so
 * matching on it would read an outcome change as a removed row plus an
 * unrelated new one instead of an update (docs/research/jorf-monitor.md,
 * "Дедупликация, contentHash и rectificatifs"). A matched commune is
 * identified by its stable `codeInsee`, not the printed label, so a
 * rectificatif that only corrects a spelling still updates the row instead
 * of colliding with it on `ArreteEntry`'s partial unique index
 * (schema.prisma). Only when either side has no resolved code is there
 * nothing stable to key on, so the raw label as printed is the fallback.
 */
function isSameEntry(
  existing: StoredEntry,
  parsedCodeInsee: string | null,
  parsed: ParsedArreteEntry,
): boolean {
  if (
    existing.risque !== parsed.risque ||
    existing.eventStart.getTime() !==
      isoDateToDate(parsed.eventStart).getTime() ||
    existing.eventEnd.getTime() !== isoDateToDate(parsed.eventEnd).getTime()
  ) {
    return false;
  }
  return existing.codeInsee && parsedCodeInsee
    ? existing.codeInsee === parsedCodeInsee
    : existing.departementRaw === parsed.departementRaw &&
        existing.communeLabelRaw === parsed.communeLabelRaw;
}

/** The distinct resolved `codeInsee`s of a list of entries — the `entryCodes` {@link resolveRecipients} fans out to, shared by the outbox write ({@link JorfMonitorService.queueNotifications}) and the send step ({@link JorfMonitorService.loadVeilleMails}), which read it off two different shapes (a bare code list, `ArreteEntry` rows) but want the same dedup-and-drop-null. */
const uniqueCodes = (codes: readonly (string | null)[]): string[] => [
  ...new Set(codes.filter((code): code is string => code !== null)),
];

/** The `detail` of an UNMATCHED_COMMUNE alert, written once because it is also the key the alert is deduplicated by ({@link JorfMonitorService.alertIfUnmatched}). */
const unmatchedDetail = (nor: string, entry: ParsedArreteEntry): string =>
  `NOR ${nor}: ${entry.communeLabelRaw} (${entry.departementRaw}) not matched to a commune`;

/** The `detail` of an UNPARSEABLE_ANNEXE alert raised by {@link JorfMonitorService.alertIfUnclassified} — same dedup-by-detail role as {@link unmatchedDetail}, for a phénomène wording `classifyRisques` doesn't recognize instead of a commune the referential doesn't resolve. */
const unclassifiedRisqueDetail = (nor: string, risque: string): string =>
  `NOR ${nor}: risque "${risque}" not classified to a RisqueCatnat`;

/** A stored row and a parsed line reduced to the same shape, so one key function reads both. The separators are NUL because everything joined into a key is free text copied from the annexe. */
type Line = {
  codeInsee: string | null;
  departementRaw: string;
  communeLabelRaw: string;
  risque: string;
  period: string;
};
const lineOf = (row: StoredEntry): Line => ({
  ...row,
  period: `${row.eventStart.getTime()}\0${row.eventEnd.getTime()}`,
});
const lineOfParsed = (
  entry: ParsedArreteEntry,
  codeInsee: string | null,
): Line => ({
  ...entry,
  codeInsee,
  period: `${isoDateToDate(entry.eventStart).getTime()}\0${isoDateToDate(entry.eventEnd).getTime()}`,
});

const communeAndRisque = (line: Line): string =>
  `${line.codeInsee ?? `${line.departementRaw}\0${line.communeLabelRaw}`}\0${line.risque}`;
const departementAndPeriod = (line: Line): string =>
  `${line.departementRaw}\0${line.risque}\0${line.period}`;

type PairedEntry = {
  entry: ParsedArreteEntry;
  codeInsee: string | null;
  match: StoredEntry | null;
};

/** One relaxed pass: claims a stored row for a line still unpaired, going by `key` alone — and only where that is not a guess, so it wants exactly one unclaimed row for exactly one unpaired line. A `null` key opts a row, or a line, out of the pass. */
function claimBy(
  pairs: PairedEntry[],
  unclaimed: Set<StoredEntry>,
  keyOfRow: (line: Line) => string | null,
  keyOfLine: (line: Line) => string | null,
): void {
  const lineKey = (pair: PairedEntry) =>
    pair.match ? null : keyOfLine(lineOfParsed(pair.entry, pair.codeInsee));
  for (const pair of pairs) {
    const key = lineKey(pair);
    if (key === null) {
      continue;
    }
    const rows = [...unclaimed].filter((row) => keyOfRow(lineOf(row)) === key);
    const [row] = rows;
    const rivals = pairs.filter((other) => lineKey(other) === key);
    if (row && rows.length === 1 && rivals.length === 1) {
      pair.match = row;
      unclaimed.delete(row);
    }
  }
}

/**
 * Pairs each line of a new revision with the stored row it corrects, in
 * passes, because a rectificatif corrects the very fields a line is identified
 * by. Exact identity first ({@link isSameEntry}); then the dates leave the key
 * — « au lieu de : du 15 au 17 janvier, lire : du 15 au 20 janvier » is the
 * everyday rectificatif, and a strict pass alone would keep the wrong period
 * and add a second row for the same commune. The risque stays in that key: a
 * phenomenon this arrêté never listed for the commune is an addition far more
 * often than a correction, and reading it as one would overwrite the original
 * line. The last pass drops the printed commune instead, and only for a stored
 * row the referential never resolved — that row's label is precisely what such
 * a rectificatif corrects, so nothing textual is left to pair on.
 */
function pairEntries(
  stored: StoredArrete['entries'],
  parsed: { entry: ParsedArreteEntry; codeInsee: string | null }[],
): PairedEntry[] {
  const unclaimed = new Set(stored);
  const pairs: PairedEntry[] = parsed.map(({ entry, codeInsee }) => {
    const match =
      stored.find(
        (row) => unclaimed.has(row) && isSameEntry(row, codeInsee, entry),
      ) ?? null;
    if (match) {
      unclaimed.delete(match);
    }
    return { entry, codeInsee, match };
  });

  claimBy(pairs, unclaimed, communeAndRisque, communeAndRisque);
  claimBy(
    pairs,
    unclaimed,
    (line) => (line.codeInsee === null ? departementAndPeriod(line) : null),
    departementAndPeriod,
  );
  return pairs;
}

/** Whether the stored row already says, field for field, what the new revision says — a rectificatif walks every line of the arrêté, and writing all ~720 back would spend the transaction's budget and stamp `updatedAt` on rows nobody corrected. */
function isUnchangedEntry(
  stored: StoredEntry,
  codeInsee: string | null,
  parsed: ParsedArreteEntry,
): boolean {
  return (
    isSameEntry(stored, codeInsee, parsed) &&
    stored.codeInsee === codeInsee &&
    stored.departementRaw === parsed.departementRaw &&
    stored.communeLabelRaw === parsed.communeLabelRaw &&
    (stored.outcome as string) === (parsed.outcome as string) &&
    stored.motivation === parsed.motivation
  );
}

/**
 * The tracer-bullet run: DILA deltas → parsed arrêtés → database, twice a day
 * (docs/research/jorf-monitor.md, "Расписание прогонов"). An annexe that
 * fails to parse, a commune the referential can't match and a rectificatif
 * that flips an outcome all alert the administrator (`MonitorAlert` row plus
 * a best-effort email to `ADMIN_EMAIL`, {@link notifyAdmin}), never just a
 * log line.
 */
@Injectable()
export class JorfMonitorService {
  private readonly logger = new Logger(JorfMonitorService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dila: DilaClient,
    private readonly mail: MailService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly deadlineRules: DeadlineRuleService,
  ) {}

  /**
   * Catches its own failures, same reason as `VeilleService.cleanupExpired`
   * (`apps/api/CLAUDE.md`, "Необработанные ошибки"). `options` is the
   * backfill script's hook (docs/research/jorf-monitor.md, "Бэкфилл с
   * 01.01.2026") — the scheduled tick never passes it: cron's own callback
   * argument arrives instead, whose every property reads `undefined`, i.e.
   * every default.
   */
  @Cron('0 6,23 * * *', { timeZone: 'Europe/Paris' })
  async run(options: RunOptions = {}): Promise<void> {
    // A backlog of deltas can outlast the gap between two ticks; two runs at
    // once would download and ingest the same pending deltas twice. The flag
    // covers this process, the ingest lock below covers the backfill script
    // running against the same database.
    if (this.running) {
      this.logger.warn('jorf monitor: previous run still going, tick skipped');
      return;
    }
    this.running = true;
    try {
      const owner = options.lockOwner ?? randomUUID();
      if (!(await this.acquireIngestLock(owner))) {
        this.logger.warn(
          'jorf monitor: ingest lock held by another process, tick skipped',
        );
        return;
      }
      try {
        await this.runOnce(options);
      } finally {
        // A backfill-owned lease outlives the run — the script releases it
        // after its last iteration ({@link RunOptions.lockOwner}).
        if (options.lockOwner === undefined) {
          await this.releaseIngestLock(owner);
        }
      }
    } catch (error) {
      this.logger.error(
        `jorf monitor run failed: ${errorSummary(error)}`,
        stackOf(error),
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Cross-process mutual exclusion of ingest runs, backed by a leased
   * `MonitorLock` row: a deployed app's scheduled tick and the backfill
   * script must never ingest concurrently, or the tick picks up the
   * script's still-pending deltas with notifications on and mails watchers
   * months-old arrêtés — the exact thing the script's `notify: false`
   * exists to prevent (docs/research/jorf-monitor.md, «Бэкфилл с
   * 01.01.2026»). The `running` flag above cannot see another process, so
   * this guard lives in the database. Re-acquiring under the same `owner`
   * renews the lease; an expired lease is taken over ({@link
   * INGEST_LOCK_TTL_MS}).
   */
  async acquireIngestLock(owner: string): Promise<boolean> {
    const now = new Date();
    const lease = {
      owner,
      expiresAt: new Date(now.getTime() + INGEST_LOCK_TTL_MS),
    };
    const renewed = await this.prisma.monitorLock.updateMany({
      where: {
        name: INGEST_LOCK_NAME,
        OR: [{ owner }, { expiresAt: { lte: now } }],
      },
      data: lease,
    });
    if (renewed.count > 0) {
      return true;
    }
    const held = await this.prisma.monitorLock.findUnique({
      where: { name: INGEST_LOCK_NAME },
      select: { name: true },
    });
    if (held) {
      // The updateMany above did not match: someone else's live lease.
      return false;
    }
    try {
      await this.prisma.monitorLock.create({
        data: { name: INGEST_LOCK_NAME, ...lease },
      });
      return true;
    } catch (error) {
      // The other process created the row between the read and this write.
      if (isUniqueViolationOn(error, 'name')) {
        return false;
      }
      throw error;
    }
  }

  /** No-op when the lease already expired and was taken over: only `owner`'s own row is deleted. */
  async releaseIngestLock(owner: string): Promise<void> {
    await this.prisma.monitorLock.deleteMany({
      where: { name: INGEST_LOCK_NAME, owner },
    });
  }

  /**
   * `candidates` not yet recorded in `JorfDelta`, order preserved — the same
   * "already done" question {@link runOnce} asks of its own delta list,
   * exposed so `apps/api/scripts/jorf-backfill.ts` can ask it of a name it is
   * about to hand `run()` as `deltaNames`, instead of re-deriving the filter
   * (root `CLAUDE.md`, "не дублировать").
   */
  async pendingDeltas(candidates: readonly string[]): Promise<string[]> {
    // Narrowed to the candidates: the table grows forever (~730 rows a year
    // plus the backfill), the answer never needs more than the list asked
    // about.
    const processed = await this.prisma.jorfDelta.findMany({
      where: { fileName: { in: [...candidates] } },
      select: { fileName: true },
    });
    const processedNames = new Set(processed.map((delta) => delta.fileName));
    return candidates.filter((name) => !processedNames.has(name));
  }

  private async runOnce(options: RunOptions): Promise<void> {
    // Drained before this tick's own ingest — a row an earlier run queued
    // gets its shot at going out before anything new is added to the outbox
    // (docs/research/jorf-monitor.md, "Рассылка: outbox на
    // VeilleNotification": "каждый прогон сначала досылает pending") — and
    // again after it, so an arrêté found at 23:00 is mailed the same evening
    // rather than at 06:00 the next calendar day (ТЗ § 6, "письмо
    // наблюдателю — в день обнаружения arrêté").
    const pass: SendPass = {
      successorOf: await loadSuccessorMap(this.prisma),
      recipients: new Map(),
      attempted: new Set(),
    };
    await this.drainOutbox(pass);

    const [deltaNames, communes] = await Promise.all([
      options.deltaNames
        ? Promise.resolve(options.deltaNames)
        : this.dila.listDeltas(),
      this.loadCommuneReferential(),
    ]);
    // listDeltas() already returns names sorted ascending; pendingDeltas()
    // preserves that order, so no second sort is needed here.
    const pending = await this.pendingDeltas(deltaNames);
    const batch = pending.slice(0, MAX_DELTAS_PER_RUN);
    if (batch.length < pending.length) {
      this.logger.warn(
        `jorf monitor: ${pending.length} deltas pending, taking the ${batch.length} oldest this run`,
      );
    }

    for (const fileName of batch) {
      let files: Map<string, string>;
      try {
        files = await this.dila.downloadDelta(fileName);
      } catch (error) {
        this.logger.error(
          `jorf monitor: downloading delta ${fileName} failed: ${errorSummary(error)}`,
          stackOf(error),
        );
        // The delta stays unmarked and is retried next tick. The newer ones
        // are still processed: deltas run oldest first, so stopping here would
        // let one permanently broken file — a 404 DILA never fixes — block
        // every delta behind it for good.
        continue;
      }

      if (
        !(await this.ingestDelta(files, communes, pass.successorOf, options))
      ) {
        // Same reason as the download failure above, and the same shape:
        // unmarked, retried next tick, newer deltas still processed. Marking
        // it here would bury the arrêté — nothing looks at that text again.
        this.logger.warn(
          `jorf monitor: delta ${fileName} left unmarked, a text failed to ingest`,
        );
        continue;
      }
      await this.prisma.jorfDelta.create({
        data: { fileName, processedAt: new Date() },
      });
    }

    // After ingest, not per delta: candidates and entries are both read
    // fresh from the database (docs/plan/sinistre-plan.md, Фаза 3, issue
    // #157), so one pass at the end of the batch sees everything this run
    // wrote, exactly like a pass per delta would.
    await this.linkSinistresGuarded(pass.successorOf);

    await this.drainOutbox(pass);
  }

  /**
   * The send step, isolated from the rest of the tick: everything it needs —
   * the déclaration `DeadlineRule` above all, which {@link
   * DeadlineRuleService.resolveActive} throws over by design — can fail, and
   * a failure there must not cost the ingest. Without this an environment
   * whose seed never ran would abort every run before {@link
   * DilaClient.listDeltas}, indefinitely, and stop finding arrêtés at all.
   *
   * Sinistre drains first, veille second — not an arbitrary order: {@link
   * loadVeilleMails}'s dedup against {@link loadSinistreCoveredEntries} only
   * counts an entry as "told" once its `SinistreNotification` is actually
   * `sentAt`, not merely queued, so a sinistre letter that keeps failing
   * never permanently silences the veille letter for the same entry. This
   * order lets the common case — the sinistre send succeeding right here —
   * still dedup the veille mail composed a few lines later in the same pass,
   * instead of only from the run after.
   */
  private async drainOutbox(pass: SendPass): Promise<void> {
    await this.runOneDrain(
      this.sinistreOutboxAdapter(),
      pass.attempted,
      'pending sinistre notifications',
    );
    await this.runOneDrain(
      this.veilleOutboxAdapter(pass),
      pass.attempted,
      'pending notifications',
    );
  }

  /** One outbox's drain, isolated the same way as {@link drainOutbox} as a
   * whole: veille and sinistre are independent adapters over independent
   * tables, so a failure composing or sending one must not skip the other. */
  private async runOneDrain<Row extends PendingOutboxRow, Mail>(
    adapter: OutboxAdapter<Row, Mail>,
    attempted: Set<string>,
    label: string,
  ): Promise<void> {
    try {
      await runOutboxDrain(this.logger, adapter, attempted);
    } catch (error) {
      this.logger.error(
        `jorf monitor: sending ${label} failed: ${errorSummary(error)}`,
        stackOf(error),
      );
    }
  }

  /** Isolated the same way as {@link drainOutbox}: a lookup or resolve
   * failure here must not cost the ingest this run already committed. */
  private async linkSinistresGuarded(
    successorOf: ReadonlyMap<string, string>,
  ): Promise<void> {
    try {
      await this.linkSinistres(successorOf);
    } catch (error) {
      this.logger.error(
        `jorf monitor: linking sinistres failed: ${errorSummary(error)}`,
        stackOf(error),
      );
    }
  }

  /**
   * Links already-created sinistres to arrêté entries through the same pure
   * `matchSinistres` `SinistresService.create` calls at creation time
   * (docs/research/sinistre-plan.md, "Привязка entry ↔ синистр") — a dossier
   * opened before its arrêté is published gets linked the moment this run
   * finds it (root `CLAUDE.md`, "план разворачивается от опорных дат"), and
   * one refused by an earlier NOR still catches a later NOR recognizing its
   * commune. Idempotent by construction: a repeat run reads the same
   * candidates and entries and reapplies the same links, and a sinistre whose
   * déclaration deadline is dated never appears among the candidates again.
   */
  private async linkSinistres(
    successorOf: ReadonlyMap<string, string>,
  ): Promise<void> {
    // Candidates are the dossiers whose déclaration deadline is still
    // undated, not a list of statuses (docs/research/sinistre-plan.md,
    // "Привязка entry ↔ синистр"): only a `RECONNU` link dates that step, so
    // the undated ones are exactly those a link can still help — unlinked,
    // refused, and the ones a `DeadlineRule` gap left dateless ({@link
    // resolveDeclarationRuleGuarded}). A status list loses the refused
    // dossier the moment its owner declares, and never sees that gap at all.
    const sinistres = await this.prisma.sinistre.findMany({
      where: UNDATED_DECLARATION_STEP,
      select: { id: true, codeInsee: true, risque: true, eventDate: true },
    });
    if (sinistres.length === 0) {
      return;
    }

    // Bounded to the candidates' own event dates: an entry outside every one
    // of them can never match any candidate, and the ArreteEntry table
    // otherwise grows for as long as the monitor runs — the same per-window
    // read `SinistresService.matchArrete` applies for its single candidate,
    // extended to the range this batch needs. Folded rather than spread into
    // `Math.min`/`Math.max`: the candidate list grows with the product, and a
    // spread of it would blow the call stack long before the query strains.
    const eventDates = sinistres.map((s) => s.eventDate.getTime());
    const oldest = eventDates.reduce((a, b) => (b < a ? b : a));
    const newest = eventDates.reduce((a, b) => (b > a ? b : a));
    const entries = await this.prisma.arreteEntry.findMany({
      where: {
        codeInsee: { not: null },
        eventStart: { lte: new Date(newest) },
        eventEnd: { gte: new Date(oldest) },
      },
      select: {
        id: true,
        arreteId: true,
        codeInsee: true,
        risque: true,
        eventStart: true,
        eventEnd: true,
        outcome: true,
        arrete: { select: { publishedAt: true } },
      },
    });
    if (entries.length === 0) {
      return;
    }

    const links = matchSinistres(
      entries.map(toMatchArreteEntry),
      sinistres.map(toMatchCandidate),
      successorOf,
    );
    if (links.length === 0) {
      return;
    }

    const entryById = new Map(
      entries.map((entry) => [
        entry.id,
        {
          id: entry.id,
          arreteId: entry.arreteId,
          outcome: entry.outcome,
          publishedAt: dateToIsoDate(entry.arrete.publishedAt),
        },
      ]),
    );
    // Memoized per publication date, resolved ahead of every write below —
    // {@link DeadlineRuleService.resolveActive} throws by design, and doing
    // that inside the transaction that applies a link would abort a write
    // already in flight over a referential gap (docs/plan/sinistre-plan.md,
    // Фаза 3, issue #157, "правило DeadlineRule резолвит снаружи транзакции
    // и передаёт внутрь").
    const ruleByPublishedAt = new Map<IsoDate, ResolvedDeadlineRule | null>();

    await this.applyMatchedLinks(
      links,
      entryById,
      ruleByPublishedAt,
      (sinistreId, entry, rule) =>
        this.applyLink(
          sinistreId,
          {
            id: entry.id,
            arreteId: entry.arreteId,
            outcome: entry.outcome,
            arrete: { publishedAt: isoDateToDate(entry.publishedAt) },
          },
          rule,
        ),
    );
  }

  /** The one `resolveActive` call for the déclaration-délai rule, shared by
   * the mail step ({@link loadVeilleMails}) and the linking pass
   * ({@link linkSinistres}) — `DECLARATION_ASSUREUR_CODE` paired with
   * `DATE_PUBLICATION_ARRETE` is spelled once, not guessed at twice. */
  private resolveDeclarationRule(onDate: Date): Promise<ResolvedDeadlineRule> {
    return this.deadlineRules.resolveActive(
      DECLARATION_ASSUREUR_CODE,
      'DATE_PUBLICATION_ARRETE',
      onDate,
    );
  }

  /** The déclaration rule plus the `ArreteForMail` shape, both derived from
   * nothing but `arrete.publishedAt`/`legifranceUrl` — every mail-loading
   * step of both outbox halves needs exactly this pair right after fetching
   * its `Arrete` row ({@link loadVeilleMails}, {@link loadSinistreMails}). */
  private async arreteMailContext(arrete: {
    publishedAt: Date;
    legifranceUrl: string;
  }): Promise<{
    declarationRule: ResolvedDeadlineRule;
    arreteForMail: ArreteForMail;
  }> {
    const declarationRule = await this.resolveDeclarationRule(
      arrete.publishedAt,
    );
    return {
      declarationRule,
      arreteForMail: {
        publishedAt: dateToIsoDate(arrete.publishedAt),
        legifranceUrl: arrete.legifranceUrl,
      },
    };
  }

  /** Same isolation as `SinistresService.resolveRule`: the product would
   * rather link the sinistre without a déclaration date than drop the whole
   * run over one missing `DeadlineRule` version. */
  private async resolveDeclarationRuleGuarded(
    publishedAt: IsoDate,
  ): Promise<ResolvedDeadlineRule | null> {
    try {
      return await this.resolveDeclarationRule(isoDateToDate(publishedAt));
    } catch (error) {
      this.logger.error(
        `jorf monitor: DeadlineRule ${DECLARATION_ASSUREUR_CODE} did not resolve for publication ${publishedAt}, linked sinistres left without a déclaration date: ${errorSummary(error)}`,
        stackOf(error),
      );
      return null;
    }
  }

  /** The "resolve once per publication date, reuse for every entry that
   * shares it" memoization {@link linkSinistres} and {@link
   * recomputeLinkedSinistres} both need — {@link DeadlineRuleService.resolveActive}
   * throws by design, and a batch of entries or sinistres sharing one
   * `publishedAt` must not pay for that resolve twice. */
  private async resolveRuleMemoized(
    publishedAt: IsoDate,
    cache: Map<IsoDate, ResolvedDeadlineRule | null>,
  ): Promise<ResolvedDeadlineRule | null> {
    if (!cache.has(publishedAt)) {
      cache.set(
        publishedAt,
        await this.resolveDeclarationRuleGuarded(publishedAt),
      );
    }
    return cache.get(publishedAt) ?? null;
  }

  /** Writes the `DATE_PUBLICATION_ARRETE` step's `plannedDate` and, when a
   * rule resolved, its citation — the one `updateMany` shape {@link applyLink}
   * (always, on a fresh RECONNU link) and {@link recomputeLinkedSinistres}
   * (only when it actually changed) both need. */
  private updateDeclarationStep(
    tx: Prisma.TransactionClient,
    sinistreId: string,
    plannedDate: IsoDate | null,
    rule: ResolvedDeadlineRule | null,
  ) {
    return tx.step.updateMany({
      where: {
        sinistreId,
        anchor: 'DATE_PUBLICATION_ARRETE',
        fromTemplate: true,
      },
      data: {
        plannedDate: plannedDate ? isoDateToDate(plannedDate) : null,
        ...(rule
          ? {
              deadlineRuleId: rule.id,
              sourceUrl: rule.sourceUrl,
              sourceVerifiedAt: rule.sourceVerifiedAt,
            }
          : {}),
      },
    });
  }

  /** Reads `status`/`declarationDate` fresh and returns the status
   * `sinistreStatus` computes off `outcome` for it — shared by {@link
   * applyLink} (always writes it) and {@link recomputeLinkedSinistres}
   * (writes only when it actually changed), so a `PATCH /sinistres/:id`
   * racing either one is never clobbered by a status computed off stale
   * data. `null` when the sinistre no longer exists (deleted mid-loop). */
  private async recomputeStatus(
    tx: Prisma.TransactionClient,
    sinistreId: string,
    outcome: ArreteEntryOutcome,
  ): Promise<{ current: SinistreStatus; next: SinistreStatus } | null> {
    const current = await tx.sinistre.findUnique({
      where: { id: sinistreId },
      select: { status: true, declarationDate: true },
    });
    if (!current) {
      return null;
    }
    return {
      current: current.status as SinistreStatus,
      next: sinistreStatus({
        current: current.status as SinistreStatus,
        link: { outcome },
        declarationDate: current.declarationDate
          ? dateToIsoDate(current.declarationDate)
          : null,
      }),
    };
  }

  /**
   * Applies one `matchSinistres` link: sets `arreteEntryId` and recomputes
   * `status` through the shared `sinistreStatus` (docs/research/
   * sinistre-plan.md, "Контракт API" — the same function `SinistresService`
   * calls, so linking on ingest never disagrees with a PATCH on what a given
   * link means; a `DECLARE` sinistre stays `DECLARE`). `status` and
   * `declarationDate` are read fresh inside this transaction, not carried
   * over from `linkSinistres`'s batch read: a `PATCH /sinistres/:id`
   * committing between that read and this sinistre's turn in the loop must
   * not be clobbered by a status computed off stale data. A `RECONNU` match
   * whose rule resolved also dates the `DATE_PUBLICATION_ARRETE` step off
   * the entry's own arrête — a `REFUSE` match, or one whose rule failed to
   * resolve, leaves that step exactly as `SinistresService.create` left it.
   *
   * The same `RECONNU`-and-`rule` branch queues the owner's `PUBLICATION`
   * `SinistreNotification` (docs/research/sinistre-plan.md, "Письмо
   * владельцу синистра и дедупликация с veille") — the outbox write sits in
   * the same transaction as the link it announces, the same pattern
   * `queueNotifications` uses for veille. A `REFUSE` match, or a rule that
   * failed to resolve, has no deadline to write a letter about. This is
   * `linkSinistres`'s only path to a `SinistreNotification`: a sinistre
   * linked at creation time (`SinistresService.create`) never reaches this
   * method, so it never gets one either (research, "Как применять" —
   * "Синистр, привязанный при создании ... письма не получает"). Opens its
   * own transaction, unlike {@link applyLinkTx}: `linkSinistres` runs outside
   * any transaction of its own, one link at a time.
   */
  private async applyLink(
    sinistreId: string,
    entry: {
      id: string;
      arreteId: string;
      outcome: ArreteEntryOutcome;
      arrete: { publishedAt: Date };
    },
    rule: ResolvedDeadlineRule | null,
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.applyLinkTx(tx, sinistreId, entry, rule, 'PUBLICATION'),
    );
  }

  /**
   * {@link applyLink}'s body, on a caller-supplied `tx` and a caller-chosen
   * `notificationKind` — the second use is {@link matchRectificatifEntries}
   * (docs/plan/sinistre-plan.md, Фаза 5, issue #164), which runs inside
   * `applyRectificatif`'s own transaction and writes `RECTIFICATIF_RECONNU`
   * instead of `PUBLICATION`, the same `kind`-in-the-key distinction
   * `docs/research/sinistre-plan.md` ("Схема...") draws.
   */
  private async applyLinkTx(
    tx: Prisma.TransactionClient,
    sinistreId: string,
    entry: {
      id: string;
      arreteId: string;
      outcome: ArreteEntryOutcome;
      arrete: { publishedAt: Date };
    },
    rule: ResolvedDeadlineRule | null,
    notificationKind: SinistreNotificationKind,
  ): Promise<void> {
    // `findUnique`, not `findUniqueOrThrow`, inside {@link recomputeStatus}:
    // a `DELETE /sinistres/:id` between the caller's batch read and this
    // link's turn in the loop costs that one dossier, not every link left to
    // apply.
    const status = await this.recomputeStatus(tx, sinistreId, entry.outcome);
    if (!status) {
      return;
    }
    await tx.sinistre.update({
      where: { id: sinistreId },
      data: { arreteEntryId: entry.id, status: status.next },
    });
    if (entry.outcome === 'RECONNU' && rule) {
      const plannedDate = resolveStepPlannedDate(
        dateToIsoDate(entry.arrete.publishedAt),
        true,
        rule,
        null,
      );
      await this.updateDeclarationStep(tx, sinistreId, plannedDate, rule);
      // One row, but `createMany` for its `skipDuplicates`, the same guard
      // and the same reason as {@link queueNotifications}: a row this
      // dossier already carries would abort not just its own link but every
      // link left in the run.
      await tx.sinistreNotification.createMany({
        data: [
          { sinistreId, arreteId: entry.arreteId, kind: notificationKind },
        ],
        skipDuplicates: true,
      });
    }
  }

  /**
   * The `matchSinistres` result loop {@link linkSinistres} and {@link
   * matchRectificatifEntries} both run: resolve the déclaration rule for a
   * `RECONNU` entry (memoized per `publishedAt`, {@link resolveRuleMemoized})
   * and hand the link to `apply`. The two callers differ only in which
   * transaction the link commits under and which `SinistreNotificationKind`
   * it writes — both belong in `apply`, not here.
   */
  private async applyMatchedLinks(
    links: readonly SinistreArreteLink[],
    entryById: ReadonlyMap<string, LinkableEntry>,
    ruleByPublishedAt: Map<IsoDate, ResolvedDeadlineRule | null>,
    apply: (
      sinistreId: string,
      entry: LinkableEntry,
      rule: ResolvedDeadlineRule | null,
    ) => Promise<void>,
  ): Promise<void> {
    for (const link of links) {
      const entry = entryById.get(link.arreteEntryId);
      if (!entry) {
        continue;
      }
      let rule: ResolvedDeadlineRule | null = null;
      if (entry.outcome === 'RECONNU') {
        rule = await this.resolveRuleMemoized(
          entry.publishedAt,
          ruleByPublishedAt,
        );
      }
      await apply(link.sinistreId, entry, rule);
    }
  }

  private async loadCommuneReferential(): Promise<CommuneReferentialEntry[]> {
    const communes = await this.prisma.commune.findMany({
      select: {
        codeInsee: true,
        nameNormalized: true,
        departementName: true,
        effectiveTo: true,
      },
    });
    // Normalized once here, not once per entry per candidate inside
    // matchCommune — a full run matches every entry of every arrêté against
    // this same referential.
    return communes.map(({ departementName, ...rest }) => ({
      ...rest,
      departementNameNormalized: normalizeCommuneName(departementName),
    }));
  }

  /**
   * Selects the catastrophe-naturelle texts of a delta via its table(s) of
   * contents, then parses and ingests each one. A text that fails to parse
   * (unrecognized annexe structure, missing metadata) is logged, alerted
   * (`MonitorAlert`, kind `UNPARSEABLE_ANNEXE`) and skipped — the rest of the
   * delta is still processed and the delta is still marked done (research,
   * "Отбор текстов и структура annexe": a parse failure is not a download
   * failure). A text that parses but cannot be written is neither: that is a
   * failure of ours, not a fact about the JO, so it raises no alert and leaves
   * the delta unmarked — the arrêté is ingested by a later run instead of
   * being lost with it.
   *
   * @returns whether every selected text was dealt with.
   */
  private async ingestDelta(
    files: Map<string, string>,
    communes: CommuneReferentialEntry[],
    successorOf: ReadonlyMap<string, string>,
    options: RunOptions,
  ): Promise<boolean> {
    const textsById = new Map<string, string>();
    const tocXmls: string[] = [];
    for (const [path, xml] of files) {
      const name = basename(path);
      if (TOC_BASENAME_PATTERN.test(name)) {
        tocXmls.push(xml);
      } else {
        textsById.set(name.replace(/\.xml$/, ''), xml);
      }
    }

    let complete = true;
    const catnatIds = new Set(tocXmls.flatMap(selectCatnatTextIds));
    for (const id of catnatIds) {
      const xml = textsById.get(id);
      if (!xml) {
        this.logger.warn(
          `jorf monitor: text ${id} is listed in a table of contents but absent from the delta`,
        );
        continue;
      }

      let parsed: ParsedArrete | null;
      try {
        parsed = parseArreteXml(xml);
      } catch (error) {
        this.logger.error(
          `jorf monitor: text ${id} failed to parse: ${errorSummary(error)}`,
          stackOf(error),
        );
        // Covers the Z-text rectificatif too — docs/research/jorf-monitor.md,
        // "Дедупликация, contentHash и rectificatifs".
        const detail = `text ${id}: ${error instanceof Error ? error.message : String(error)}`;
        // DILA re-delivers the same text in the evening delta and in every
        // later one it belongs to; the operator works through this table by
        // hand, so the same unread text must not fill it row by row.
        const recorded = await this.prisma.monitorAlert.findFirst({
          where: { kind: 'UNPARSEABLE_ANNEXE', detail },
          select: { id: true },
        });
        if (!recorded) {
          const alert = await this.prisma.monitorAlert.create({
            data: { kind: 'UNPARSEABLE_ANNEXE', detail },
          });
          await this.notifyAdmin([alert]);
        }
        continue;
      }
      if (!parsed) {
        continue;
      }

      try {
        await this.ingestArrete(parsed, communes, successorOf, options);
      } catch (error) {
        this.logger.error(
          `jorf monitor: text ${id} failed to ingest: ${errorSummary(error)}`,
          stackOf(error),
        );
        complete = false;
      }
    }
    return complete;
  }

  /**
   * NOR-dedup (research, "Дедупликация, contentHash и rectificatifs"): a new
   * NOR is created with both annexes; an unchanged `contentHash` only bumps
   * `lastSeenAt`; a changed `contentHash` is a rectificatif — entries are
   * upserted, not replaced wholesale ({@link applyRectificatif}).
   */
  private async ingestArrete(
    parsed: ParsedArrete,
    communes: CommuneReferentialEntry[],
    successorOf: ReadonlyMap<string, string>,
    options: RunOptions,
  ): Promise<void> {
    const now = new Date();
    const existing = await this.prisma.arrete.findUnique({
      where: { nor: parsed.nor },
      include: { entries: true, monitorAlerts: { select: { detail: true } } },
    });

    if (existing && existing.contentHash === parsed.contentHash) {
      await this.prisma.arrete.update({
        where: { id: existing.id },
        data: { lastSeenAt: now },
      });
      return;
    }

    if (
      !existing &&
      options.minPublishedAt !== undefined &&
      parsed.publishedAt < options.minPublishedAt
    ) {
      // A rectificatif for a NOR the backfill has not created yet: the
      // corrected text's own publishedAt would otherwise create an arrêté
      // predating the backfill's declared start (research, "Бэкфилл с
      // 01.01.2026"). The delta is still fully handled, not left unmarked.
      this.logger.log(
        `jorf monitor: NOR ${parsed.nor} published ${parsed.publishedAt}, before the backfill floor ${options.minPublishedAt} — skipped`,
      );
      return;
    }

    // Not computed above: the unchanged-content path just returned, before
    // needing it — matching cost per entry is why ({@link loadCommuneReferential}).
    const matched = parsed.entries.map((entry) => ({
      entry,
      codeInsee: matchCommune(
        communes,
        entry.communeLabelRaw,
        entry.departementRaw,
      ),
    }));

    if (!existing) {
      const alerts: MonitorAlertForMail[] = [];
      // Nothing recorded yet, but a commune printed on two lines of the same
      // annexe is still one commune to fix by hand, not two alerts.
      const recorded = new Set<string>();
      await this.prisma.$transaction(
        async (tx) => {
          const created = await tx.arrete.create({
            data: {
              nor: parsed.nor,
              signedAt: isoDateToDate(parsed.signedAt),
              publishedAt: isoDateToDate(parsed.publishedAt),
              jorfNumber: parsed.jorfNumber,
              legifranceUrl: parsed.legifranceUrl,
              firstSeenAt: now,
              lastSeenAt: now,
              contentHash: parsed.contentHash,
              entries: {
                create: matched.map(({ entry, codeInsee }) =>
                  entryData(entry, codeInsee),
                ),
              },
            },
          });
          for (const { entry, codeInsee } of matched) {
            await this.alertIfUnmatched(
              tx,
              alerts,
              recorded,
              created.id,
              parsed.nor,
              entry,
              codeInsee,
            );
            await this.alertIfUnclassified(
              tx,
              alerts,
              recorded,
              created.id,
              parsed.nor,
              entry,
            );
          }
          await this.queueNotifications(
            tx,
            created.id,
            matched.map((m) => m.codeInsee),
            successorOf,
            options,
          );
        },
        { timeout: INGEST_TX_TIMEOUT_MS },
      );
      await this.notifyAdmin(alerts);
      return;
    }

    await this.applyRectificatif(
      existing,
      parsed,
      matched,
      now,
      successorOf,
      options,
    );
  }

  /**
   * The outbox write of {@link resolveRecipients} (docs/research/
   * jorf-monitor.md, "Рассылка: outbox на VeilleNotification") — a pending
   * `VeilleNotification` per (veille, arrêté), created in the same
   * transaction as the entries that make the recipient eligible. `codes` is
   * the set an arrêté revision actually adds: every matched entry on the
   * first-seen path, only the newly added ones on a rectificatif ({@link
   * applyRectificatif}) — a rectificatif that merely corrects or flips the
   * outcome of an already-notified commune must not re-notify its watchers.
   * `skipDuplicates` is what makes that rectificatif path safe: a watcher of
   * an already-notified commune who also watches the newly added one would
   * otherwise collide with their own pending/sent row on `unique(veilleId,
   * arreteId)` and abort the whole transaction.
   *
   * Subscriptions are read here, on `tx`, not snapshotted once per run: the
   * run downloads and parses tarballs for minutes, and a watcher who
   * confirms in that window would otherwise be missing from the snapshot —
   * and since the outbox is only ever written at ingest time, they would
   * never receive this arrêté at all.
   *
   * {@link RunOptions.notify} is honored here, not at the call sites: an
   * ingest path that forgot a copy of the guard would mail watchers during
   * a backfill — the exact bug the knob exists to prevent.
   */
  private async queueNotifications(
    tx: Prisma.TransactionClient,
    arreteId: string,
    codes: readonly (string | null)[],
    successorOf: ReadonlyMap<string, string>,
    options: RunOptions,
  ): Promise<void> {
    if (options.notify === false) {
      return;
    }
    const entryCodes = uniqueCodes(codes);
    if (entryCodes.length === 0) {
      return;
    }
    const recipients = resolveRecipients(
      entryCodes,
      successorOf,
      await this.loadConfirmedSubscriptions(tx),
    );
    if (recipients.length === 0) {
      return;
    }
    await tx.veilleNotification.createMany({
      data: recipients.map((recipient) => ({
        veilleId: recipient.veilleId,
        arreteId,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Writes a `MonitorAlert` unless `detail` is already in `recorded` — the
   * alerts this arrêté carries plus the ones raised earlier in this run.
   * Shared by {@link alertIfUnmatched} and {@link alertIfUnclassified}: both
   * alert once per (arrêté, distinct fact) and must not grow the operator's
   * table again when a rectificatif reprints the same unresolved commune or
   * unrecognized phénomène wording. Appends to the caller's `alerts`
   * accumulator rather than returning one, so its callers don't each repeat
   * the same if-and-push.
   */
  private async alertOnce(
    tx: Prisma.TransactionClient,
    alerts: MonitorAlertForMail[],
    recorded: Set<string>,
    kind: MonitorAlertKind,
    arreteId: string,
    detail: string,
  ): Promise<void> {
    if (recorded.has(detail)) {
      return;
    }
    recorded.add(detail);
    alerts.push(
      await tx.monitorAlert.create({ data: { kind, arreteId, detail } }),
    );
  }

  /**
   * `MonitorAlert` for an entry the referential couldn't resolve (research,
   * "Сопоставление коммун со справочником") — the row itself is already
   * written with `codeInsee: null` by the caller, on both the first-seen and
   * the rectificatif path, this only makes the gap visible instead of a
   * silent drop.
   */
  private async alertIfUnmatched(
    tx: Prisma.TransactionClient,
    alerts: MonitorAlertForMail[],
    recorded: Set<string>,
    arreteId: string,
    nor: string,
    entry: ParsedArreteEntry,
    codeInsee: string | null,
  ): Promise<void> {
    if (codeInsee !== null) {
      return;
    }
    await this.alertOnce(
      tx,
      alerts,
      recorded,
      'UNMATCHED_COMMUNE',
      arreteId,
      unmatchedDetail(nor, entry),
    );
  }

  /**
   * `MonitorAlert` for an entry whose `risque` wording `classifyRisques`
   * folds to an empty set — the JO printed a phénomène wording the mapping
   * (docs/research/sinistre-plan.md, "Классификация риска") doesn't cover
   * yet.
   */
  private async alertIfUnclassified(
    tx: Prisma.TransactionClient,
    alerts: MonitorAlertForMail[],
    recorded: Set<string>,
    arreteId: string,
    nor: string,
    entry: ParsedArreteEntry,
  ): Promise<void> {
    if (classifyRisques(entry.risque).size > 0) {
      return;
    }
    await this.alertOnce(
      tx,
      alerts,
      recorded,
      'UNPARSEABLE_ANNEXE',
      arreteId,
      unclassifiedRisqueDetail(nor, entry.risque),
    );
  }

  /**
   * The push channel on top of `MonitorAlert` (research, "Алерты
   * администратору"): every row here is already committed by the caller, so
   * a failed send costs only the notification, never the record — pending
   * alerts stay visible in the table, and no retry is built for the mail
   * itself. One message for all of them ({@link monitorAlertMailFor}), never
   * one per row: an arrêté lists hundreds of communes, and a referential that
   * resolves none of them would otherwise be hundreds of messages in a row.
   * Unset `ADMIN_EMAIL` means a fresh clone with no admin inbox configured yet.
   */
  private async notifyAdmin(
    alerts: readonly MonitorAlertForMail[],
  ): Promise<void> {
    const adminEmail = this.config.get('ADMIN_EMAIL', { infer: true });
    if (!adminEmail || alerts.length === 0) {
      return;
    }
    try {
      await this.mail.send(monitorAlertMailFor(adminEmail, alerts));
    } catch (error) {
      this.logger.error(
        `jorf monitor: alert email to admin failed: ${errorSummary(error)}`,
        stackOf(error),
      );
    }
  }

  /**
   * Entries are paired with the rows they correct ({@link pairEntries}), not
   * replaced wholesale: an unpaired line is a newly added commune (created), a
   * paired one is updated in place, and one that already matches the stored
   * row is left alone ({@link isUnchangedEntry}). A paired entry whose
   * `outcome` flips gets a `MonitorAlert` in the same transaction as the
   * update it describes — decision and consequences in data-model.md § 4.
   * Either branch can also resolve to `codeInsee: null` (a newly added
   * commune the referential doesn't know, or a previously matched one the
   * referential no longer resolves) — {@link alertIfUnmatched} covers both.
   * Entries missing from the new revision are left as-is: the rectificatif
   * format observed never removes a commune, only adds or corrects one.
   */
  private async applyRectificatif(
    existing: StoredArrete,
    parsed: ParsedArrete,
    matched: { entry: ParsedArreteEntry; codeInsee: string | null }[],
    now: Date,
    successorOf: ReadonlyMap<string, string>,
    options: RunOptions,
  ): Promise<void> {
    const alerts: MonitorAlertForMail[] = [];
    const recorded = new Set(existing.monitorAlerts.map((a) => a.detail));
    const pairs = pairEntries(existing.entries, matched);
    const publishedAt = isoDateToDate(parsed.publishedAt);
    const publishedAtChanged =
      existing.publishedAt.getTime() !== publishedAt.getTime();
    if (publishedAtChanged) {
      // The anchor of the 30-day déclaration deadline moving under everyone
      // this arrêté covers. It follows the XML like every other field of the
      // row — the JO is the only source (ТЗ § 7) — but not quietly.
      this.logger.warn(
        `jorf monitor: NOR ${parsed.nor} publication date ${existing.publishedAt.toISOString().slice(0, 10)} → ${parsed.publishedAt}`,
      );
    }
    // One `DeadlineRule` resolve per publication date, not per touched entry
    // — every entry of the same arrêté shares the same `publishedAt`, the
    // same memoization {@link linkSinistres} uses.
    const ruleByPublishedAt = new Map<IsoDate, ResolvedDeadlineRule | null>();
    // What this revision adds — the set {@link queueNotifications} fans out
    // to, so a rectificatif that only corrects or flips the outcome of an
    // already-notified commune (PRD critère "смена исхода... не порождает
    // автоматических писем") never reaches it. Two shapes: a pair with no
    // stored match, and a paired row whose `codeInsee` changes to a resolved
    // one — a line the referential could not place is stored with
    // `codeInsee: null`, which fans out to nobody, so once an operator fixes
    // the referential and a later revision resolves it, that commune's
    // watchers are being notified for the first time, not again.
    const addedCodes: (string | null)[] = [];
    // Added or corrected entries only — the pool {@link matchRectificatifEntries}
    // (second pass, docs/plan/sinistre-plan.md, Фаза 5, issue #164) matches
    // against. An entry left untouched by this revision cannot newly qualify
    // any sinistre: its commune, risque and period are exactly what a match
    // is decided on.
    const touchedEntries: MatchArreteEntry[] = [];
    await this.prisma.$transaction(
      async (tx) => {
        for (const { entry, codeInsee, match } of pairs) {
          if (!match) {
            const created = await tx.arreteEntry.create({
              data: { arreteId: existing.id, ...entryData(entry, codeInsee) },
            });
            addedCodes.push(codeInsee);
            touchedEntries.push(
              toMatchEntry(created.id, codeInsee, entry, parsed.publishedAt),
            );
          } else {
            if (codeInsee !== null && match.codeInsee !== codeInsee) {
              addedCodes.push(codeInsee);
            }
            if ((match.outcome as string) !== (entry.outcome as string)) {
              alerts.push(
                await tx.monitorAlert.create({
                  data: {
                    kind: 'OUTCOME_CHANGED',
                    arreteId: existing.id,
                    detail: `NOR ${parsed.nor}: ${entry.communeLabelRaw} (${entry.departementRaw}) ${match.outcome} → ${entry.outcome}`,
                  },
                }),
              );
            }
            const entryChanged = !isUnchangedEntry(match, codeInsee, entry);
            if (entryChanged) {
              await tx.arreteEntry.update({
                where: { id: match.id },
                data: entryData(entry, codeInsee),
              });
              touchedEntries.push(
                toMatchEntry(match.id, codeInsee, entry, parsed.publishedAt),
              );
            }
            if (entryChanged || publishedAtChanged) {
              await this.recomputeLinkedSinistres(
                tx,
                alerts,
                existing.id,
                parsed.nor,
                match.id,
                entry,
                codeInsee,
                parsed.publishedAt,
                successorOf,
                ruleByPublishedAt,
              );
            }
          }
          await this.alertIfUnmatched(
            tx,
            alerts,
            recorded,
            existing.id,
            parsed.nor,
            entry,
            codeInsee,
          );
          await this.alertIfUnclassified(
            tx,
            alerts,
            recorded,
            existing.id,
            parsed.nor,
            entry,
          );
        }
        await this.queueNotifications(
          tx,
          existing.id,
          addedCodes,
          successorOf,
          options,
        );
        if (touchedEntries.length > 0) {
          await this.matchRectificatifEntries(
            tx,
            touchedEntries,
            existing.id,
            successorOf,
            ruleByPublishedAt,
          );
        }

        await tx.arrete.update({
          where: { id: existing.id },
          data: {
            contentHash: parsed.contentHash,
            lastSeenAt: now,
            signedAt: isoDateToDate(parsed.signedAt),
            publishedAt,
            jorfNumber: parsed.jorfNumber,
            legifranceUrl: parsed.legifranceUrl,
          },
        });
      },
      { timeout: INGEST_TX_TIMEOUT_MS },
    );
    await this.notifyAdmin(alerts);
  }

  /**
   * The rectificatif's first pass (docs/plan/sinistre-plan.md, Фаза 5, issue
   * #163; docs/research/sinistre-plan.md, "Пересчёт при rectificatif"): every
   * `Sinistre` already linked to a touched entry gets its `status` recomputed
   * off the new `outcome` and its `DATE_PUBLICATION_ARRETE` step's
   * `plannedDate` off the new `publishedAt`, through the same
   * `sinistreStatus`/`resolveStepPlannedDate` pair `linkSinistres` and
   * `SinistresService` already use — never a second copy of that arithmetic.
   * A no-op read when the entry has no linked sinistre yet: {@link
   * matchRectificatifEntries} (second pass) is what creates new links, not
   * this one.
   *
   * A step whose `plannedDate` goes from unset to set — a `REFUSE → RECONNU`
   * flip on the very entry a sinistre is already linked to — queues a
   * `RECTIFICATIF_RECONNU` `SinistreNotification` (docs/research/
   * sinistre-plan.md, "Пересчёт при rectificatif": "письмо владельцу уходит
   * там, где сроки появляются"). Moving an already-dated deadline (critère
   * PRD № 12) does not: the date changes, but it was never missing, so
   * nothing newly needs telling. The reverse flip — `plannedDate` going back
   * to unset — sends nothing either way.
   *
   * `outcome === RECONNU` resolves the déclaration `DeadlineRule` again, on
   * the (possibly moved) `publishedAt` — a version change or a corrected date
   * can both change which rule applies. A referential gap leaves the step
   * exactly as it was, the same isolation {@link resolveDeclarationRuleGuarded}
   * gives `linkSinistres`; `outcome !== RECONNU` clears `plannedDate` back to
   * null (no déclaration deadline exists to date) but deliberately leaves
   * `deadlineRuleId`/`sourceUrl`/`sourceVerifiedAt` as last resolved, never
   * nulled — `SinistresService.create`'s own REFUSE steps keep a citation
   * without a date the same way (resolved off the sinistre's creation date,
   * research "Шаблон плана"), and `SinistresService.update`'s own recompute
   * reuses a step's already-chosen rule rather than re-resolving it too.
   *
   * A sinistre `matchSinistres` would no longer link — the entry's `risque`
   * or period moved out from under it — is left linked and only alerted: per
   * the research decision, only a person may take an already-assigned
   * deadline away.
   *
   * Every difference this produces (`status`, `plannedDate`, or the
   * mismatch) raises one `LINKED_ENTRY_CHANGED` `MonitorAlert` per sinistre —
   * data-model.md § 4 requires an alert on every change to a linked entry's
   * legal consequences.
   */
  private async recomputeLinkedSinistres(
    tx: Prisma.TransactionClient,
    alerts: MonitorAlertForMail[],
    arreteId: string,
    nor: string,
    entryId: string,
    entry: ParsedArreteEntry,
    codeInsee: string | null,
    publishedAt: IsoDate,
    successorOf: ReadonlyMap<string, string>,
    ruleByPublishedAt: Map<IsoDate, ResolvedDeadlineRule | null>,
  ): Promise<void> {
    const sinistres = await tx.sinistre.findMany({
      where: { arreteEntryId: entryId },
      select: { id: true, codeInsee: true, risque: true, eventDate: true },
    });
    if (sinistres.length === 0) {
      return;
    }

    // `undefined` means "leave the step as it is" (a referential gap), never
    // conflated with `null` ("no déclaration deadline exists to date").
    let newPlannedDate: IsoDate | null | undefined = null;
    let rule: ResolvedDeadlineRule | null = null;
    if ((entry.outcome as string) === 'RECONNU') {
      rule = await this.resolveRuleMemoized(publishedAt, ruleByPublishedAt);
      newPlannedDate = rule
        ? resolveStepPlannedDate(publishedAt, true, rule, null)
        : undefined;
    }

    const matchEntry = toMatchEntry(entryId, codeInsee, entry, publishedAt);

    for (const sinistre of sinistres) {
      // {@link recomputeStatus} reads fresh, not carried over from the batch
      // findMany above: a `PATCH /sinistres/:id` committing between that
      // read and this sinistre's turn in the loop must not be clobbered by
      // a status computed off stale data (e.g. a CLOS or a just-set DECLARE
      // landing mid-loop).
      const status = await this.recomputeStatus(tx, sinistre.id, entry.outcome);
      if (!status) {
        continue;
      }
      const newStatus = status.next;
      const statusChanged =
        (newStatus as string) !== (status.current as string);

      const step = await tx.step.findFirst({
        where: {
          sinistreId: sinistre.id,
          anchor: 'DATE_PUBLICATION_ARRETE',
          fromTemplate: true,
        },
      });
      const oldPlannedDate = step?.plannedDate
        ? dateToIsoDate(step.plannedDate)
        : null;
      const stepChanged =
        step !== null &&
        newPlannedDate !== undefined &&
        oldPlannedDate !== newPlannedDate;

      const stillMatches =
        matchSinistres(
          [matchEntry],
          [
            {
              id: sinistre.id,
              codeInsee: sinistre.codeInsee,
              risque: sinistre.risque as RisqueCatnat,
              eventDate: dateToIsoDate(sinistre.eventDate),
            },
          ],
          successorOf,
        ).length > 0;

      if (!statusChanged && !stepChanged && stillMatches) {
        continue;
      }

      if (statusChanged) {
        await tx.sinistre.update({
          where: { id: sinistre.id },
          data: { status: newStatus },
        });
      }
      if (stepChanged) {
        await this.updateDeclarationStep(
          tx,
          sinistre.id,
          newPlannedDate ?? null,
          rule,
        );
        if (oldPlannedDate === null && newPlannedDate) {
          await tx.sinistreNotification.createMany({
            data: [
              {
                sinistreId: sinistre.id,
                arreteId,
                kind: 'RECTIFICATIF_RECONNU',
              },
            ],
            skipDuplicates: true,
          });
        }
      }

      const changes = [
        statusChanged && `statut ${status.current} → ${newStatus}`,
        stepChanged &&
          `échéance déclaration ${oldPlannedDate ?? '—'} → ${newPlannedDate ?? '—'}`,
        !stillMatches && 'ne correspond plus au sinistre (risque ou période)',
      ].filter((line): line is string => typeof line === 'string');
      alerts.push(
        await tx.monitorAlert.create({
          data: {
            kind: 'LINKED_ENTRY_CHANGED',
            arreteId,
            detail: `NOR ${nor}: sinistre ${sinistre.id} — ${changes.join('; ')}`,
          },
        }),
      );
    }
  }

  /**
   * The rectificatif's second pass (docs/plan/sinistre-plan.md, Фаза 5, issue
   * #164; docs/research/sinistre-plan.md, "Пересчёт при rectificatif"):
   * `matchSinistres` over every entry this revision added or corrected
   * ({@link applyRectificatif}'s `touchedEntries`), against the same
   * candidate pool `linkSinistres` draws from on ingest
   * ({@link UNDATED_DECLARATION_STEP}) — a rectificatif routinely adds
   * communes to the annexe and corrects an event period, and a sinistre that
   * only qualifies now must not wait for the next arrêté to get linked.
   * Applied through {@link applyLinkTx} with `RECTIFICATIF_RECONNU`, not
   * `PUBLICATION` — the unique key on `kind` is exactly what lets a dossier
   * whose commune is only now recognised get its letter through this path.
   * `entryChanged` already covers an outcome flip on a still-unlinked or
   * `ARRETE_REFUSE` candidate, so a corrected line resolving to `REFUSE`
   * still links here (no letter, {@link applyLinkTx}'s own branch) rather
   * than waiting for a `RECONNU` revision to notice it.
   */
  private async matchRectificatifEntries(
    tx: Prisma.TransactionClient,
    touchedEntries: readonly MatchArreteEntry[],
    arreteId: string,
    successorOf: ReadonlyMap<string, string>,
    ruleByPublishedAt: Map<IsoDate, ResolvedDeadlineRule | null>,
  ): Promise<void> {
    const candidates = await tx.sinistre.findMany({
      where: UNDATED_DECLARATION_STEP,
      select: { id: true, codeInsee: true, risque: true, eventDate: true },
    });
    if (candidates.length === 0) {
      return;
    }

    const links = matchSinistres(
      touchedEntries,
      candidates.map(toMatchCandidate),
      successorOf,
    );
    if (links.length === 0) {
      return;
    }

    const entryById = new Map(
      touchedEntries.map((entry) => [
        entry.id,
        {
          id: entry.id,
          arreteId,
          outcome: entry.outcome,
          publishedAt: entry.publishedAt,
        },
      ]),
    );
    await this.applyMatchedLinks(
      links,
      entryById,
      ruleByPublishedAt,
      (sinistreId, entry, rule) =>
        this.applyLinkTx(
          tx,
          sinistreId,
          {
            id: entry.id,
            arreteId: entry.arreteId,
            outcome: entry.outcome,
            arrete: { publishedAt: isoDateToDate(entry.publishedAt) },
          },
          rule,
          'RECTIFICATIF_RECONNU',
        ),
    );
  }

  /**
   * The pool {@link resolveRecipients} draws an arrêté's recipients from on
   * the outbox write, read on the caller's client so it can join the ingest
   * transaction ({@link queueNotifications}). Confirmed by the query itself
   * (critère "неподтверждённая veille писем не получает"), so every row is
   * `confirmed: true` by construction. Not narrowed to the arrêté's codes:
   * a watcher of a commune since merged into one of them counts too, and
   * `resolveRecipients` is the one place that walks `successorCodeInsee` —
   * a second, backwards walk here to build a `where` would be that knowledge
   * written twice.
   */
  private async loadConfirmedSubscriptions(
    client: Prisma.TransactionClient,
  ): Promise<SubscribedCommune[]> {
    const rows = await client.veilleCommune.findMany({
      where: { veille: { confirmedAt: { not: null } } },
      select: { veilleId: true, codeInsee: true },
    });
    return rows.map((row) => ({ ...row, confirmed: true as const }));
  }

  /**
   * The `NOTIFICATION_STUCK` alert both outbox adapters' `onStuck` raise at
   * the same threshold, on the same row shape (research, "Механика досылки
   * ... у двух outbox'ов общие") — `label` is the one thing that tells a
   * veille row from a sinistre one in the alert's `detail`, since neither
   * carries an address (ТЗ § 7, "в логи не попадают email").
   */
  private async raiseNotificationStuck(
    norByArrete: ReadonlyMap<string, string>,
    arreteId: string,
    label: string,
    rowId: string,
    attempts: number,
  ): Promise<void> {
    const nor = norByArrete.get(arreteId) ?? arreteId;
    const alert = await this.prisma.monitorAlert.create({
      data: {
        kind: 'NOTIFICATION_STUCK',
        arreteId,
        detail: `NOR ${nor}: ${label} ${rowId} не отправлено после ${attempts} попыток`,
      },
    });
    await this.notifyAdmin([alert]);
  }

  /**
   * The veille half of the shared outbox drain (`src/jorf/mail/
   * drain-outbox.ts`) — loading, composing and marking `VeilleNotification`
   * rows. `pass` carries the run-scoped recipient memo ({@link SendPass})
   * across both drains of one run, so a watcher's unsubscribe token is
   * minted once and reused between them ({@link recipientFor}). `norByArrete`
   * is filled by {@link loadVeilleMails} before `onStuck` can ever be called
   * for a row of the same group — the generic cycle always composes a
   * group's mails before touching any of its rows' attempts.
   */
  private veilleOutboxAdapter(
    pass: SendPass,
  ): OutboxAdapter<PendingNotification, ComposeMailInput> {
    const norByArrete = new Map<string, string>();
    return {
      loadPending: () =>
        this.prisma.veilleNotification.findMany({
          where: { sentAt: null },
          select: { id: true, veilleId: true, arreteId: true, attempts: true },
        }),
      loadMails: (arreteId, notifications) =>
        this.loadVeilleMails(arreteId, notifications, pass, norByArrete),
      send: (mail) => this.mail.send(mail),
      markSent: async (notification) => {
        await this.prisma.veilleNotification.update({
          where: { id: notification.id },
          data: { sentAt: new Date() },
        });
      },
      incrementAttempts: async (notification) => {
        const attempts = notification.attempts + 1;
        await this.prisma.veilleNotification.update({
          where: { id: notification.id },
          data: { attempts },
        });
        return attempts;
      },
      onStuck: (notification, attempts) =>
        this.raiseNotificationStuck(
          norByArrete,
          notification.arreteId,
          'уведомление',
          notification.id,
          attempts,
        ),
    };
  }

  /**
   * One arrêté group's mails. The commune set a recipient's mail carries is
   * not stored on `VeilleNotification` — it is recomputed here via
   * {@link resolveRecipients}, the same function the outbox write used,
   * scoped to just these `veilleId`s so this stays one query regardless of
   * how many other watchers the database holds (critère "не дублировать").
   * A row with nothing left to mail — the watcher dropped every commune this
   * arrêté names since the row was queued — maps to `null`, drained without
   * a mail; a row whose token can't be rotated ({@link recipientFor}) is
   * left out of the map entirely, so the generic cycle leaves it untouched.
   */
  private async loadVeilleMails(
    arreteId: string,
    notifications: readonly PendingNotification[],
    pass: SendPass,
    norByArrete: Map<string, string>,
  ): Promise<ReadonlyMap<string, ComposeMailInput | null>> {
    const arrete = await this.prisma.arrete.findUnique({
      where: { id: arreteId },
      include: { entries: { include: { commune: true } } },
    });
    if (!arrete) {
      // Arrete.notifications is onDelete: Restrict — an Arrete referenced by
      // a pending row cannot actually be deleted — but findUnique still
      // wants a null check to type-check.
      return new Map();
    }
    norByArrete.set(arreteId, arrete.nor);

    const entryCodes = uniqueCodes(
      arrete.entries.map((entry) => entry.codeInsee),
    );
    const subscriptionRows = await this.prisma.veilleCommune.findMany({
      where: {
        veilleId: { in: notifications.map((n) => n.veilleId) },
        veille: { confirmedAt: { not: null } },
      },
      select: { veilleId: true, codeInsee: true },
    });
    const subscriptions: SubscribedCommune[] = subscriptionRows.map((row) => ({
      ...row,
      confirmed: true as const,
    }));
    const codesByVeille = new Map(
      resolveRecipients(entryCodes, pass.successorOf, subscriptions).map(
        (recipient) => [recipient.veilleId, recipient.codeInsee],
      ),
    );
    const coveredByEmail = await this.loadSinistreCoveredEntries(arreteId);
    const emailByVeille = new Map(
      (
        await this.prisma.veille.findMany({
          where: { id: { in: notifications.map((n) => n.veilleId) } },
          select: { id: true, email: true },
        })
      ).map((veille) => [veille.id, veille.email]),
    );

    const { declarationRule, arreteForMail } =
      await this.arreteMailContext(arrete);

    const mails = new Map<string, ComposeMailInput | null>();
    for (const notification of notifications) {
      const codes = codesByVeille.get(notification.veilleId) ?? [];
      if (codes.length === 0) {
        mails.set(notification.id, null);
        continue;
      }

      const relevant: { id: string; mail: ArreteEntryForMail }[] = [];
      for (const entry of arrete.entries) {
        if (
          entry.codeInsee === null ||
          !codes.includes(entry.codeInsee) ||
          !entry.commune
        ) {
          continue;
        }
        relevant.push({
          id: entry.id,
          mail: {
            commune: {
              name: entry.commune.name,
              departementName: entry.commune.departementName,
            },
            risque: entry.risque,
            eventStart: dateToIsoDate(entry.eventStart),
            eventEnd: dateToIsoDate(entry.eventEnd),
            outcome: entry.outcome,
          },
        });
      }

      // Drops what a sinistre letter this same address already got covers
      // ({@link subtractCoveredEntries}) — before the token rotation below,
      // so a row left with nothing to mail after dedup never burns one (same
      // reason the empty-`codes` branch above returns early).
      const email = emailByVeille.get(notification.veilleId);
      const covered = email ? coveredByEmail.get(email) : undefined;
      const remaining = covered
        ? subtractCoveredEntries(relevant, covered)
        : relevant;
      if (remaining.length === 0) {
        mails.set(notification.id, null);
        continue;
      }

      const recipient = await this.recipientFor(pass, notification.veilleId);
      if (!recipient) {
        continue;
      }

      mails.set(
        notification.id,
        veilleArreteMailFor(
          recipient.email,
          recipient.unsubscribeToken,
          arreteForMail,
          remaining.map((entry) => entry.mail),
          declarationRule,
        ),
      );
    }
    return mails;
  }

  /**
   * Address → the arrêté entries a sinistre letter has actually told it about
   * (docs/research/sinistre-plan.md, "Письмо владельцу синистра и
   * дедупликация с veille") — what {@link loadVeilleMails} subtracts from a
   * watcher's own entry list, through {@link subtractCoveredEntries}, before
   * composing their mail. Both `kind`s count: a `RECTIFICATIF_RECONNU` letter
   * ({@link matchRectificatifEntries}, {@link recomputeLinkedSinistres}) tells
   * the owner about the entry exactly as a `PUBLICATION` one does — the
   * dedup this method feeds does not care which arrêté revision prompted the
   * letter. The entry is read off the sinistre's current link, the same one
   * {@link loadSinistreMails} composes the letter from, so the two never
   * disagree about what was said; a dossier unlinked or relinked since covers
   * nothing, and its watcher hears about the commune again — the safe
   * direction of the two.
   *
   * Filtered to `sentAt: { not: null }`, not merely queued: a sinistre letter
   * that keeps failing must not permanently silence the veille letter for the
   * same entry too — {@link drainOutbox} runs the sinistre adapter first
   * precisely so a send that succeeds this very pass still counts here, and
   * only a send that has actually gone out ever suppresses the veille mail.
   */
  private async loadSinistreCoveredEntries(
    arreteId: string,
  ): Promise<Map<string, Set<string>>> {
    const rows = await this.prisma.sinistreNotification.findMany({
      where: { arreteId, sentAt: { not: null } },
      select: {
        sinistre: {
          select: { arreteEntryId: true, user: { select: { email: true } } },
        },
      },
    });
    const byEmail = new Map<string, Set<string>>();
    for (const { sinistre } of rows) {
      if (sinistre.arreteEntryId === null) {
        continue;
      }
      const entryIds = byEmail.get(sinistre.user.email) ?? new Set<string>();
      entryIds.add(sinistre.arreteEntryId);
      byEmail.set(sinistre.user.email, entryIds);
    }
    return byEmail;
  }

  /**
   * The sinistre half of the shared outbox drain (`src/jorf/mail/
   * drain-outbox.ts`) — loading, composing and marking `SinistreNotification`
   * rows, both `kind`s alike: `sinistreArreteMailFor` composes the same
   * letter off the sinistre's current link regardless of whether the row is
   * `PUBLICATION` or `RECTIFICATIF_RECONNU` (docs/research/sinistre-plan.md,
   * "Пересчёт при rectificatif" — the `kind` only disambiguates the
   * `unique(sinistreId, arreteId, kind)` key, it carries no wording of its
   * own). No `SendPass`, unlike {@link veilleOutboxAdapter}: this letter's
   * unsubscribe link carries no rotating token ({@link
   * sinistreArreteMailFor}), so there is nothing to memoize across the run's
   * two drains.
   */
  private sinistreOutboxAdapter(): OutboxAdapter<
    PendingSinistreNotification,
    ComposeMailInput
  > {
    const norByArrete = new Map<string, string>();
    return {
      loadPending: () =>
        this.prisma.sinistreNotification.findMany({
          where: { sentAt: null },
          select: {
            id: true,
            sinistreId: true,
            arreteId: true,
            attempts: true,
          },
        }),
      loadMails: (arreteId, rows) =>
        this.loadSinistreMails(arreteId, rows, norByArrete),
      send: (mail) => this.mail.send(mail),
      markSent: async (row) => {
        await this.prisma.sinistreNotification.update({
          where: { id: row.id },
          data: { sentAt: new Date() },
        });
      },
      incrementAttempts: async (row) => {
        const attempts = row.attempts + 1;
        await this.prisma.sinistreNotification.update({
          where: { id: row.id },
          data: { attempts },
        });
        return attempts;
      },
      onStuck: (row, attempts) =>
        this.raiseNotificationStuck(
          norByArrete,
          row.arreteId,
          'уведомление синистра',
          row.id,
          attempts,
        ),
    };
  }

  /**
   * One arrêté group's sinistre mails — each row is one owner, one commune,
   * unlike {@link loadVeilleMails}'s fan-out (research, "Письмо владельцу
   * синистра и дедупликация с veille": "одно письмо ... не батчит несколько
   * писем в один вызов"). A dossier deleted, or unlinked, between the write
   * and the send maps to `null`: nothing left to tell its former owner.
   */
  private async loadSinistreMails(
    arreteId: string,
    rows: readonly PendingSinistreNotification[],
    norByArrete: Map<string, string>,
  ): Promise<ReadonlyMap<string, ComposeMailInput | null>> {
    const arrete = await this.prisma.arrete.findUnique({
      where: { id: arreteId },
    });
    if (!arrete) {
      // Same restrict-makes-this-unreachable null check as loadVeilleMails.
      return new Map();
    }
    norByArrete.set(arreteId, arrete.nor);

    const sinistres = await this.prisma.sinistre.findMany({
      where: { id: { in: rows.map((row) => row.sinistreId) } },
      select: {
        id: true,
        commune: { select: { name: true, departementName: true } },
        arreteEntry: { select: { risque: true } },
        user: { select: { email: true } },
      },
    });
    const sinistreById = new Map(sinistres.map((s) => [s.id, s]));

    const { declarationRule, arreteForMail } =
      await this.arreteMailContext(arrete);

    const mails = new Map<string, ComposeMailInput | null>();
    for (const row of rows) {
      const sinistre = sinistreById.get(row.sinistreId);
      if (!sinistre || !sinistre.arreteEntry) {
        mails.set(row.id, null);
        continue;
      }
      mails.set(
        row.id,
        sinistreArreteMailFor(
          sinistre.user.email,
          {
            name: sinistre.commune.name,
            departementName: sinistre.commune.departementName,
          },
          sinistre.arreteEntry.risque,
          arreteForMail,
          declarationRule,
        ),
      );
    }
    return mails;
  }

  /**
   * One watcher's address and unsubscribe token for this run, minted on
   * first use and reused afterwards — {@link SendPass}. Deliberately called
   * from inside the per-recipient loop, not ahead of it: rotating for a row
   * that turns out to have nothing to mail (its watcher dropped every
   * commune since it was queued) would silently kill the link in every mail
   * already delivered to them, with no new mail carrying a replacement.
   */
  private async recipientFor(
    pass: SendPass,
    veilleId: string,
  ): Promise<Recipient | null> {
    const memoized = pass.recipients.get(veilleId);
    if (memoized !== undefined) {
      return memoized;
    }
    const recipient = await this.rotateUnsubscribeToken(veilleId);
    pass.recipients.set(veilleId, recipient);
    return recipient;
  }

  /**
   * Rotates one watcher's unsubscribe token for the mail about to go out,
   * same pattern as `VeilleService.rotateAndSendChangeMail`
   * (`apps/api/src/veille/veille.service.ts`) — only `unsubscribeTokenHash`
   * is stored, so the plaintext token a mail can link to only ever exists
   * right after this write. `null` means the watcher's row is gone (cascaded
   * away with the Veille) or no longer confirmed — Veille never reverts
   * `confirmedAt` once set (`apps/api/src/veille/CLAUDE.md`, "Жизненный цикл
   * подписки"), so this is the same defensive race guard
   * `rotateAndSendChangeMail` takes, not a reachable branch under normal
   * operation.
   */
  private async rotateUnsubscribeToken(
    veilleId: string,
  ): Promise<{ email: string; unsubscribeToken: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const unsubscribe = generateVeilleToken();
      const result = await tx.veille.updateMany({
        where: { id: veilleId, confirmedAt: { not: null } },
        data: { unsubscribeTokenHash: unsubscribe.hash },
      });
      if (result.count === 0) {
        return null;
      }
      const veille = await tx.veille.findUniqueOrThrow({
        where: { id: veilleId },
        select: { email: true },
      });
      return { email: veille.email, unsubscribeToken: unsubscribe.token };
    });
  }
}
