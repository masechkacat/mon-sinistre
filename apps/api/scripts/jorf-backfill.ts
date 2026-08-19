import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  validateEnv,
  type EnvironmentVariables,
} from '../src/config/env.validation';
import { DilaClient } from '../src/jorf/dila.client';
import {
  JorfMonitorService,
  MAX_DELTAS_PER_RUN,
} from '../src/jorf/jorf-monitor.service';
import {
  BACKFILL_MIN_PUBLISHED_AT,
  selectBackfillDeltas,
} from '../src/jorf/select-backfill-deltas';
import { composerOptionsFrom, transportFor } from '../src/mail/mail.module';
import { MailComposer } from '../src/mail/mail-composer';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

// No Nest application context on purpose — same reasoning as prisma/seed.ts:
// this one-off script needs the monitor's plain classes with notify: false
// (docs/research/jorf-monitor.md, "Бэкфилл с 01.01.2026"), not a bootstrap of
// AppModule.
//
// Run from apps/api/: npx ts-node -r tsconfig-paths/register scripts/jorf-backfill.ts
// (tsconfig-paths/register is required — the modules imported below resolve
// each other through the `src/...` path alias, same as prisma.config.ts's
// seed command). No npm script wires this in: package.json is off-limits to
// this codebase's automated iteration (`.claude/ralph.md`), so adding one is
// left for a human.

try {
  process.loadEnvFile();
} catch {
  // .env is absent — variables come from the environment (e.g. CI).
}

async function main(): Promise<void> {
  const config = new ConfigService<EnvironmentVariables, true>(
    validateEnv(process.env),
  );
  const prisma = new PrismaService(config);
  const dila = new DilaClient();
  const mail = new MailService(
    new MailComposer(composerOptionsFrom(config)),
    transportFor(config),
  );
  const monitor = new JorfMonitorService(prisma, dila, mail, config);

  await prisma.$connect();
  try {
    const backfillDeltas = selectBackfillDeltas(await dila.listDeltas());
    if (backfillDeltas.length === 0) {
      console.log(
        'jorf backfill: catalogue has nothing at or after 2026-01-01.',
      );
      return;
    }

    // Held across the whole loop, not per run(): a deployed app's scheduled
    // tick sharing this database would otherwise ingest the still-pending
    // historical deltas with notifications on. While the script holds the
    // lease (each run() below renews it), the tick skips itself.
    const lockOwner = randomUUID();
    if (!(await monitor.acquireIngestLock(lockOwner))) {
      throw new Error(
        'jorf backfill: another process holds the ingest lock (a deployed app mid-run?) — wait for its tick to finish or stop the app, then re-run',
      );
    }
    const before = await tableCounts(prisma);
    try {
      let remaining = await monitor.pendingDeltas(backfillDeltas);
      // One run() ingests only the oldest MAX_DELTAS_PER_RUN of `remaining`,
      // so a single pass with no progress says nothing about the deltas
      // behind that batch — and a transient network hiccup fails a whole
      // batch at once. One free retry tells the two apart; a second
      // no-progress pass means the same deltas failed the same way twice,
      // and run() already logged why.
      let stalledPasses = 0;
      while (remaining.length > 0) {
        console.log(
          `jorf backfill: ${remaining.length} delta(s) left, oldest ${remaining[0]}…`,
        );
        await monitor.run({
          notify: false,
          deltaNames: remaining,
          minPublishedAt: BACKFILL_MIN_PUBLISHED_AT,
          lockOwner,
        });
        const next = await monitor.pendingDeltas(backfillDeltas);
        stalledPasses =
          next.length === remaining.length ? stalledPasses + 1 : 0;
        if (stalledPasses === 2) {
          throw new Error(
            `jorf backfill: no progress in two passes over the oldest ${Math.min(next.length, MAX_DELTAS_PER_RUN)} of ${next.length} pending delta(s), starting with ${next[0]} — see the errors above, then re-run the script`,
          );
        }
        remaining = next;
      }
    } finally {
      await monitor.releaseIngestLock(lockOwner);
    }

    // Only this run's contribution: on a database the monitor already
    // populated — or on a re-run after an abort — whole-table totals would
    // credit the backfill with rows it never touched.
    const after = await tableCounts(prisma);
    console.log(
      `jorf backfill done: +${after.arretes - before.arretes} arrêtés (${after.arretes} total), +${after.entries - before.entries} entries, +${after.unmatched - before.unmatched} unmatched, +${after.alerts - before.alerts} alerts.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function tableCounts(prisma: PrismaService) {
  const [arretes, entries, unmatched, alerts] = await Promise.all([
    prisma.arrete.count(),
    prisma.arreteEntry.count(),
    prisma.arreteEntry.count({ where: { codeInsee: null } }),
    prisma.monitorAlert.count(),
  ]);
  return { arretes, entries, unmatched, alerts };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
