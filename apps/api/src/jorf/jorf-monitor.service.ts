import { basename } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { IsoDate } from '@mon-sinistre/contracts';
import { Cron } from '@nestjs/schedule';
import { errorSummary, stackOf } from 'src/common/error-report';
import { normalizeCommuneName } from 'src/communes/normalize-commune-name';
import { PrismaService } from 'src/prisma/prisma.service';
import { DilaClient } from './dila.client';
import { type CommuneReferentialEntry, matchCommune } from './match-commune';
import { type ParsedArrete, parseArreteXml } from './parse-arrete';
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

/**
 * The tracer-bullet run: DILA deltas → parsed arrêtés → database, twice a day
 * (docs/research/jorf-monitor.md, "Расписание прогонов"). No alerts and no
 * mail yet — an unmatched commune or an unparseable annexe is only logged
 * (phase 2 turns them into `MonitorAlert` rows).
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
   * (unrecognized annexe structure, missing metadata) is logged and skipped —
   * the rest of the delta is still processed and the delta is still marked
   * done (research, "Отбор текстов и структура annexe": a parse failure is
   * not a download failure).
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
      }
    }
  }

  /**
   * NOR-dedup (research, "Дедупликация, contentHash и rectificatifs"): a new
   * NOR is created with both annexes; a NOR already in the database only gets
   * its `lastSeenAt` bumped — upserting entries on a changed `contentHash`
   * (the rectificatif path) is phase 2's job, not this tracer bullet's.
   */
  private async ingestArrete(
    parsed: ParsedArrete,
    communes: CommuneReferentialEntry[],
  ): Promise<void> {
    const now = new Date();
    const existing = await this.prisma.arrete.findUnique({
      where: { nor: parsed.nor },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.arrete.update({
        where: { id: existing.id },
        data: { lastSeenAt: now },
      });
      return;
    }

    await this.prisma.arrete.create({
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
          create: parsed.entries.map((entry) => ({
            codeInsee: matchCommune(
              communes,
              entry.communeLabelRaw,
              entry.departementRaw,
            ),
            communeLabelRaw: entry.communeLabelRaw,
            departementRaw: entry.departementRaw,
            risque: entry.risque,
            eventStart: isoDateToDate(entry.eventStart),
            eventEnd: isoDateToDate(entry.eventEnd),
            outcome: entry.outcome,
            motivation: entry.motivation,
          })),
        },
      },
    });
  }
}
