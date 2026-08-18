import { basename } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { IsoDate } from '@mon-sinistre/contracts';
import { Cron } from '@nestjs/schedule';
import { errorSummary, stackOf } from 'src/common/error-report';
import { normalizeCommuneName } from 'src/communes/normalize-commune-name';
import type { Prisma } from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { DilaClient } from './dila.client';
import { type CommuneReferentialEntry, matchCommune } from './match-commune';
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

/** UTC midnight of an `IsoDate`, for `@db.Date` columns — the Prisma client requires a full ISO-8601 `Date`, not a bare `YYYY-MM-DD` string. */
const isoDateToDate = (value: IsoDate): Date => new Date(`${value}T00:00:00Z`);

type ArreteWithEntries = Prisma.ArreteGetPayload<{
  include: { entries: true };
}>;

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
  existing: ArreteWithEntries['entries'][number],
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

/**
 * The tracer-bullet run: DILA deltas → parsed arrêtés → database, twice a day
 * (docs/research/jorf-monitor.md, "Расписание прогонов"). An annexe that
 * fails to parse and a commune the referential can't match both alert the
 * administrator (`MonitorAlert`), never just a log line.
 */
@Injectable()
export class JorfMonitorService {
  private readonly logger = new Logger(JorfMonitorService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dila: DilaClient,
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

      await this.ingestDelta(files, communes);
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
   * failure).
   */
  private async ingestDelta(
    files: Map<string, string>,
    communes: CommuneReferentialEntry[],
  ): Promise<void> {
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

    const catnatIds = new Set(tocXmls.flatMap(selectCatnatTextIds));
    for (const id of catnatIds) {
      const xml = textsById.get(id);
      if (!xml) {
        this.logger.warn(
          `jorf monitor: text ${id} is listed in a table of contents but absent from the delta`,
        );
        continue;
      }

      try {
        const parsed = parseArreteXml(xml);
        if (parsed) {
          await this.ingestArrete(parsed, communes);
        }
      } catch (error) {
        this.logger.error(
          `jorf monitor: text ${id} failed to parse: ${errorSummary(error)}`,
          stackOf(error),
        );
        // Covers the Z-text rectificatif too — docs/research/jorf-monitor.md,
        // "Дедупликация, contentHash и rectificatifs".
        await this.prisma.monitorAlert.create({
          data: {
            kind: 'UNPARSEABLE_ANNEXE',
            detail: `text ${id}: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      }
    }
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
      include: { entries: true },
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
      await this.prisma.$transaction(async (tx) => {
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
            created.id,
            parsed.nor,
            entry,
            codeInsee,
          );
        }
      });
      return;
    }

    await this.applyRectificatif(existing, parsed, matched, now);
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
    arreteId: string,
    nor: string,
    entry: ParsedArreteEntry,
    codeInsee: string | null,
  ): Promise<void> {
    if (codeInsee !== null) {
      return;
    }
    await tx.monitorAlert.create({
      data: {
        kind: 'UNMATCHED_COMMUNE',
        arreteId,
        detail: `NOR ${nor}: ${entry.communeLabelRaw} (${entry.departementRaw}) not matched to a commune`,
      },
    });
  }

  /**
   * Entries are matched to their existing row by {@link isSameEntry}, not
   * replaced wholesale: an unmatched parsed entry is a newly added commune
   * (created), a matched one is updated in place. A matched entry whose
   * `outcome` flips gets a `MonitorAlert` in the same transaction as the
   * update it describes — decision and consequences in data-model.md § 4.
   * Either branch can also resolve to `codeInsee: null` (a newly added
   * commune the referential doesn't know, or a previously matched one the
   * referential no longer resolves) — {@link alertIfUnmatched} covers both.
   * Entries missing from the new revision are left as-is: the rectificatif
   * format observed never removes a commune, only adds or corrects one.
   */
  private async applyRectificatif(
    existing: ArreteWithEntries,
    parsed: ParsedArrete,
    matched: { entry: ParsedArreteEntry; codeInsee: string | null }[],
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const { entry, codeInsee } of matched) {
        const match = existing.entries.find((candidate) =>
          isSameEntry(candidate, codeInsee, entry),
        );

        if (!match) {
          await tx.arreteEntry.create({
            data: { arreteId: existing.id, ...entryData(entry, codeInsee) },
          });
          await this.alertIfUnmatched(
            tx,
            existing.id,
            parsed.nor,
            entry,
            codeInsee,
          );
          continue;
        }

        if ((match.outcome as string) !== (entry.outcome as string)) {
          await tx.monitorAlert.create({
            data: {
              kind: 'OUTCOME_CHANGED',
              arreteId: existing.id,
              detail: `NOR ${parsed.nor}: ${entry.communeLabelRaw} (${entry.departementRaw}) ${match.outcome} → ${entry.outcome}`,
            },
          });
        }

        await tx.arreteEntry.update({
          where: { id: match.id },
          data: entryData(entry, codeInsee),
        });
        await this.alertIfUnmatched(
          tx,
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
          jorfNumber: parsed.jorfNumber,
          legifranceUrl: parsed.legifranceUrl,
        },
      });
    });
  }
}
