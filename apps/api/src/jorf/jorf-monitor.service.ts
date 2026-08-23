import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { IsoDate } from '@mon-sinistre/contracts';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { errorSummary, stackOf } from 'src/common/error-report';
import { normalizeCommuneName } from 'src/communes/normalize-commune-name';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service';
import { DECLARATION_ASSUREUR_CODE } from 'src/deadline-rules/deadline-rule.seed';
import { dateToIsoDate } from 'src/deadline-rules/resolve-deadline';
import type { Prisma } from 'src/generated/prisma/client';
import { MailService } from 'src/mail/mail.service';
import { isUniqueViolationOn } from 'src/prisma/prisma-error';
import { PrismaService } from 'src/prisma/prisma.service';
import { generateVeilleToken } from 'src/veille/veille-token';
import { DilaClient } from './dila/dila.client';
import {
  type CommuneReferentialEntry,
  matchCommune,
} from './recipients/match-commune';
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
} from './recipients/resolve-recipients';
import { selectCatnatTextIds } from './parse/select-catnat-texts';
import {
  type ArreteEntryForMail,
  type ArreteForMail,
  type DeclarationDeadlineRule,
  veilleArreteMailFor,
} from './mail/veille-arrete-mail';

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

/** `monitorAlerts` comes along as the key {@link JorfMonitorService.alertIfUnmatched} deduplicates by: an alert already recorded for a commune must not be raised, nor emailed, again on every rectificatif that follows. */
type StoredArrete = Prisma.ArreteGetPayload<{
  include: { entries: true; monitorAlerts: { select: { detail: true } } };
}>;
type StoredEntry = StoredArrete['entries'][number];

/** A pending outbox row, reduced to what {@link JorfMonitorService.sendPendingNotifications} needs to send it. */
type PendingNotification = {
  id: string;
  veilleId: string;
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

/**
 * Failed sends of one outbox row before it is called stuck. Four runs' worth
 * of retries at two ticks a day (≈ two days): long enough that a mailbox
 * down for a day resolves itself unannounced, short enough that a row the
 * transport will never accept surfaces while the arrêté still matters.
 */
export const NOTIFICATION_ATTEMPTS_BEFORE_ALERT = 4;

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

/** The distinct resolved `codeInsee`s of a list of entries — the `entryCodes` {@link resolveRecipients} fans out to, shared by the outbox write ({@link JorfMonitorService.queueNotifications}) and the send step ({@link JorfMonitorService.sendArreteNotifications}), which read it off two different shapes (a bare code list, `ArreteEntry` rows) but want the same dedup-and-drop-null. */
const uniqueCodes = (codes: readonly (string | null)[]): string[] => [
  ...new Set(codes.filter((code): code is string => code !== null)),
];

/** The `detail` of an UNMATCHED_COMMUNE alert, written once because it is also the key the alert is deduplicated by ({@link JorfMonitorService.alertIfUnmatched}). */
const unmatchedDetail = (nor: string, entry: ParsedArreteEntry): string =>
  `NOR ${nor}: ${entry.communeLabelRaw} (${entry.departementRaw}) not matched to a commune`;

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
      successorOf: await this.loadSuccessorMap(),
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

    await this.drainOutbox(pass);
  }

  /**
   * The send step, isolated from the rest of the tick: everything it needs —
   * the déclaration `DeadlineRule` above all, which {@link
   * DeadlineRuleService.resolveActive} throws over by design — can fail, and
   * a failure there must not cost the ingest. Without this an environment
   * whose seed never ran would abort every run before {@link
   * DilaClient.listDeltas}, indefinitely, and stop finding arrêtés at all.
   */
  private async drainOutbox(pass: SendPass): Promise<void> {
    try {
      await this.sendPendingNotifications(pass);
    } catch (error) {
      this.logger.error(
        `jorf monitor: sending pending notifications failed: ${errorSummary(error)}`,
        stackOf(error),
      );
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
   * `MonitorAlert` for an entry the referential couldn't resolve (research,
   * "Сопоставление коммун со справочником") — the row itself is already
   * written with `codeInsee: null` by the caller, on both the first-seen and
   * the rectificatif path, this only makes the gap visible instead of a
   * silent drop. Appends to the caller's `alerts` accumulator rather than
   * returning one, so its two call sites don't each repeat the same
   * if-and-push.
   *
   * `recorded` is what this arrêté has already alerted about — the alerts it
   * carries plus the ones raised earlier in this run. A commune the
   * referential will never resolve (a fusion the COG doesn't have yet) is
   * printed again by every rectificatif, and the table an operator works
   * through by hand must not grow a row, and send a message, each time.
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
    const detail = unmatchedDetail(nor, entry);
    if (codeInsee !== null || recorded.has(detail)) {
      return;
    }
    recorded.add(detail);
    alerts.push(
      await tx.monitorAlert.create({
        data: { kind: 'UNMATCHED_COMMUNE', arreteId, detail },
      }),
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
    if (existing.publishedAt.getTime() !== publishedAt.getTime()) {
      // The anchor of the 30-day déclaration deadline moving under everyone
      // this arrêté covers. It follows the XML like every other field of the
      // row — the JO is the only source (ТЗ § 7) — but not quietly.
      this.logger.warn(
        `jorf monitor: NOR ${parsed.nor} publication date ${existing.publishedAt.toISOString().slice(0, 10)} → ${parsed.publishedAt}`,
      );
    }
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
    await this.prisma.$transaction(
      async (tx) => {
        for (const { entry, codeInsee, match } of pairs) {
          if (!match) {
            await tx.arreteEntry.create({
              data: { arreteId: existing.id, ...entryData(entry, codeInsee) },
            });
            addedCodes.push(codeInsee);
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
            if (!isUnchangedEntry(match, codeInsee, entry)) {
              await tx.arreteEntry.update({
                where: { id: match.id },
                data: entryData(entry, codeInsee),
              });
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
        }
        await this.queueNotifications(
          tx,
          existing.id,
          addedCodes,
          successorOf,
          options,
        );

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

  /** `Commune.successorCodeInsee` reduced to a map, read once per run for both the outbox write ({@link queueNotifications}, via {@link resolveRecipients}) and the send step below — only rows that merged carry one, so this is a small fraction of the referential. */
  private async loadSuccessorMap(): Promise<Map<string, string>> {
    const rows = await this.prisma.commune.findMany({
      where: { successorCodeInsee: { not: null } },
      select: { codeInsee: true, successorCodeInsee: true },
    });
    return new Map(
      rows
        .filter(
          (row): row is { codeInsee: string; successorCodeInsee: string } =>
            row.successorCodeInsee !== null,
        )
        .map((row) => [row.codeInsee, row.successorCodeInsee]),
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
   * The send half of the outbox (docs/research/jorf-monitor.md, "Рассылка:
   * outbox на VeilleNotification"): every `VeilleNotification` still
   * `sentAt: null`, grouped by arrêté since that is what a recipient's
   * entries and the déclaration deadline are resolved against
   * ({@link sendArreteNotifications}). Called twice per run, before and
   * after the ingest — {@link runOnce}.
   *
   * An arrêté whose group throws costs only its own mails: the déclaration
   * rule, the arrêté row and the subscriptions behind it are all read per
   * group, and one of them being unavailable says nothing about the next
   * group (ТЗ § 6, "сбой отправки одному получателю не прерывает рассылку
   * остальным" — the same guarantee one level up from the per-recipient
   * `try/catch`).
   */
  private async sendPendingNotifications(pass: SendPass): Promise<void> {
    const pending = (
      await this.prisma.veilleNotification.findMany({
        where: { sentAt: null },
        select: { id: true, veilleId: true, arreteId: true, attempts: true },
      })
    ).filter((notification) => !pass.attempted.has(notification.id));
    if (pending.length === 0) {
      return;
    }

    const byArrete = new Map<string, PendingNotification[]>();
    for (const notification of pending) {
      const forArrete = byArrete.get(notification.arreteId) ?? [];
      forArrete.push(notification);
      byArrete.set(notification.arreteId, forArrete);
    }

    for (const [arreteId, notifications] of byArrete) {
      for (const notification of notifications) {
        pass.attempted.add(notification.id);
      }
      try {
        await this.sendArreteNotifications(arreteId, notifications, pass);
      } catch (error) {
        this.logger.error(
          `jorf monitor: notifications for arrete ${arreteId} failed: ${errorSummary(error)}`,
          stackOf(error),
        );
      }
    }
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

  /**
   * Sends every pending notification of one arrêté. The commune set a
   * recipient's mail carries is not stored on `VeilleNotification` — it is
   * recomputed here via {@link resolveRecipients}, the same function the
   * outbox write used, scoped to just these `veilleId`s so this stays one
   * query regardless of how many other watchers the database holds
   * (critère "не дублировать"). A failed send is logged and left `sentAt:
   * null` (critère № 12: the next recipient still gets theirs, the row goes
   * out next run) — a `try/catch` per recipient, not around the loop.
   */
  private async sendArreteNotifications(
    arreteId: string,
    notifications: readonly PendingNotification[],
    pass: SendPass,
  ): Promise<void> {
    const arrete = await this.prisma.arrete.findUnique({
      where: { id: arreteId },
      include: { entries: { include: { commune: true } } },
    });
    if (!arrete) {
      // Arrete.notifications is onDelete: Restrict — an Arrete referenced by
      // a pending row cannot actually be deleted — but findUnique still
      // wants a null check to type-check.
      return;
    }

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

    const declarationRule = await this.deadlineRules.resolveActive(
      DECLARATION_ASSUREUR_CODE,
      'DATE_PUBLICATION_ARRETE',
      arrete.publishedAt,
    );
    const arreteForMail: ArreteForMail = {
      publishedAt: dateToIsoDate(arrete.publishedAt),
      legifranceUrl: arrete.legifranceUrl,
    };

    for (const notification of notifications) {
      const codes = codesByVeille.get(notification.veilleId) ?? [];
      if (codes.length === 0) {
        // The watcher unsubscribed or dropped every commune this arrêté
        // names since the row was queued — nothing left to mail. Marking it
        // sent drains the row instead of retrying forever.
        await this.prisma.veilleNotification.update({
          where: { id: notification.id },
          data: { sentAt: new Date() },
        });
        continue;
      }

      const recipient = await this.recipientFor(pass, notification.veilleId);
      if (!recipient) {
        continue;
      }

      const entries: ArreteEntryForMail[] = [];
      for (const entry of arrete.entries) {
        if (
          entry.codeInsee === null ||
          !codes.includes(entry.codeInsee) ||
          !entry.commune
        ) {
          continue;
        }
        entries.push({
          commune: {
            name: entry.commune.name,
            departementName: entry.commune.departementName,
          },
          risque: entry.risque,
          eventStart: dateToIsoDate(entry.eventStart),
          eventEnd: dateToIsoDate(entry.eventEnd),
          outcome: entry.outcome,
        });
      }

      try {
        await this.sendOneNotification(
          notification,
          recipient,
          entries,
          arreteForMail,
          declarationRule,
        );
      } catch (error) {
        this.logger.error(
          `jorf monitor: notification email failed: ${errorSummary(error)}`,
          stackOf(error),
        );
        await this.recordFailedAttempt(notification, arrete.nor);
      }
    }
  }

  /**
   * Counts a failed send on the row and, at {@link
   * NOTIFICATION_ATTEMPTS_BEFORE_ALERT}, raises `NOTIFICATION_STUCK` once.
   * A row nothing will ever accept — a mailbox permanently rejecting, a
   * composition error — otherwise stays `sentAt: null` and is retried by
   * every run for good, visible only as a log line, and each retry burns a
   * fresh unsubscribe token on it. Alerting exactly at the threshold, not
   * above it, is what keeps the following runs from repeating the alert.
   */
  private async recordFailedAttempt(
    notification: PendingNotification,
    nor: string,
  ): Promise<void> {
    const attempts = notification.attempts + 1;
    await this.prisma.veilleNotification.update({
      where: { id: notification.id },
      data: { attempts },
    });
    if (attempts !== NOTIFICATION_ATTEMPTS_BEFORE_ALERT) {
      return;
    }
    const alert = await this.prisma.monitorAlert.create({
      data: {
        kind: 'NOTIFICATION_STUCK',
        arreteId: notification.arreteId,
        // The watcher is identified by the outbox row, never by address:
        // alerts are emailed and stored (ТЗ § 7, "в логи не попадают email").
        detail: `NOR ${nor}: уведомление ${notification.id} не отправлено после ${attempts} попыток`,
      },
    });
    await this.notifyAdmin([alert]);
  }

  /**
   * One recipient's mail. `sentAt` is stamped only after `MailService.send`
   * resolves — a thrown `MailDeliveryError` leaves the row pending for the
   * next run, and the caller's `try/catch` moves on to the next recipient.
   */
  private async sendOneNotification(
    notification: PendingNotification,
    recipient: { email: string; unsubscribeToken: string },
    entries: readonly ArreteEntryForMail[],
    arrete: ArreteForMail,
    declarationRule: DeclarationDeadlineRule,
  ): Promise<void> {
    await this.mail.send(
      veilleArreteMailFor(
        recipient.email,
        recipient.unsubscribeToken,
        arrete,
        entries,
        declarationRule,
      ),
    );

    await this.prisma.veilleNotification.update({
      where: { id: notification.id },
      data: { sentAt: new Date() },
    });
  }
}
