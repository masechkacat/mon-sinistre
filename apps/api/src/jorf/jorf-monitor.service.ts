import { basename } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { IsoDate } from '@mon-sinistre/contracts';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { errorSummary, stackOf } from 'src/common/error-report';
import { normalizeCommuneName } from 'src/communes/normalize-commune-name';
import type { EnvironmentVariables } from 'src/config/env.validation';
import type { Prisma } from 'src/generated/prisma/client';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { DilaClient } from './dila.client';
import { type CommuneReferentialEntry, matchCommune } from './match-commune';
import {
  type MonitorAlertForMail,
  monitorAlertMailFor,
} from './monitor-alert-mail';
import {
  type ParsedArrete,
  type ParsedArreteEntry,
  parseArreteXml,
} from './parse-arrete';
import { selectCatnatTextIds } from './select-catnat-texts';

const TOC_BASENAME_PATTERN = /^JORFCONT/;

/**
 * A cold start finds every delta the catalogue lists (two a day, 28 KB–18 MB
 * each), so one tick would try to download years of them in a row. The rest
 * is picked up by the following ticks, oldest first; loading history in bulk
 * is the backfill script's job, not the monitor's.
 */
export const MAX_DELTAS_PER_RUN = 8;

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
  ) {}

  /**
   * Catches its own failures, same reason as `VeilleService.cleanupExpired`
   * (`apps/api/CLAUDE.md`, "Необработанные ошибки").
   */
  @Cron('0 6,23 * * *', { timeZone: 'Europe/Paris' })
  async run(): Promise<void> {
    // A backlog of deltas can outlast the gap between two ticks; two runs at
    // once would download and ingest the same pending deltas twice.
    if (this.running) {
      this.logger.warn('jorf monitor: previous run still going, tick skipped');
      return;
    }
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(
        `jorf monitor run failed: ${errorSummary(error)}`,
        stackOf(error),
      );
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<void> {
    const [deltaNames, processed, communes] = await Promise.all([
      this.dila.listDeltas(),
      this.prisma.jorfDelta.findMany({ select: { fileName: true } }),
      this.loadCommuneReferential(),
    ]);
    const processedNames = new Set(processed.map((delta) => delta.fileName));
    // listDeltas() already returns names sorted ascending; filter() preserves
    // that order, so no second sort is needed here.
    const pending = deltaNames.filter((name) => !processedNames.has(name));
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

      if (!(await this.ingestDelta(files, communes))) {
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
        await this.ingestArrete(parsed, communes);
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
        },
        { timeout: INGEST_TX_TIMEOUT_MS },
      );
      await this.notifyAdmin(alerts);
      return;
    }

    await this.applyRectificatif(existing, parsed, matched, now);
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
    await this.prisma.$transaction(
      async (tx) => {
        for (const { entry, codeInsee, match } of pairs) {
          if (!match) {
            await tx.arreteEntry.create({
              data: { arreteId: existing.id, ...entryData(entry, codeInsee) },
            });
          } else {
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
}
