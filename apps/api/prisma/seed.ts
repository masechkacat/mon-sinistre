import { PrismaPg } from '@prisma/adapter-pg';
import { CommuneImportService } from '../src/communes/import/commune-import.service';
import { GeoApiClient } from '../src/communes/import/geo-api.client';
import { seedDeadlineRules } from '../src/deadline-rules/deadline-rule.seed';
import { PrismaClient } from '../src/generated/prisma/client';
import { databaseUrlFromEnv } from '../src/prisma/database-url-from-env';

// No Nest application context on purpose: the seed depends only on DB_* and
// the network, while bootstrapping AppModule would demand the full validated
// environment (JWT secrets etc.) and a built contracts package
// (docs/research/commune-referential.md, «Архитектура seed»).

// The seed process is spawned by the Prisma CLI — inheriting the env loaded
// in prisma.config.ts is not guaranteed, so load .env here as well.
try {
  process.loadEnvFile();
} catch {
  // .env is absent — variables come from the environment (e.g. CI).
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrlFromEnv() }),
  });

  try {
    // Fail fast on a broken DB config before downloading the ~4 MB
    // referential — without this the first query runs after the fetch.
    await prisma.$connect();
    console.log('Importing the commune referential from geo.api.gouv.fr…');
    const importService = new CommuneImportService(prisma, new GeoApiClient());
    const { processed, total } = await importService.run();
    console.log(`Commune import done: ${processed}/${total} upserts.`);

    console.log('Seeding deadline rules…');
    await seedDeadlineRules(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Counts, codes INSEE and driver errors only — the referential holds no
  // personal data, and none may enter the logs anyway.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
