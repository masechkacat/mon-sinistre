import { ConfigService } from '@nestjs/config';
import {
  validateEnv,
  type EnvironmentVariables,
} from '../src/config/env.validation';
import { DilaClient } from '../src/jorf/dila.client';
import { JorfMonitorService } from '../src/jorf/jorf-monitor.service';
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

    let remaining = await monitor.pendingDeltas(backfillDeltas);
    while (remaining.length > 0) {
      console.log(
        `jorf backfill: ${remaining.length} delta(s) left, oldest ${remaining[0]}…`,
      );
      await monitor.run(false, {
        deltaNames: remaining,
        minPublishedAt: BACKFILL_MIN_PUBLISHED_AT,
      });
      const next = await monitor.pendingDeltas(backfillDeltas);
      if (next.length === remaining.length) {
        // Every remaining delta failed the same way this run (download error
        // or a text that parsed but could not be written) — run() already
        // logged why. Retrying it right away would just repeat the failure.
        throw new Error(
          `jorf backfill: stuck on ${next.length} delta(s), starting with ${next[0]} — see the errors above, then re-run the script`,
        );
      }
      remaining = next;
    }

    const [arretes, entries, unmatched, alerts] = await Promise.all([
      prisma.arrete.count(),
      prisma.arreteEntry.count(),
      prisma.arreteEntry.count({ where: { codeInsee: null } }),
      prisma.monitorAlert.count(),
    ]);
    console.log(
      `jorf backfill done: ${arretes} arrêtés, ${entries} entries, ${unmatched} unmatched, ${alerts} alerts.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
