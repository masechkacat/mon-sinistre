import { PrismaPg } from '@prisma/adapter-pg';
import e2eDbName from '../test/setup/e2e-db-name';
import prepareDatabase from '../test/setup/prepare-database';
import { PrismaClient } from '../src/generated/prisma/client';
import { databaseUrlFromEnv } from '../src/prisma/database-url-from-env';
import { seedE2eReferential } from '../test/helpers/e2e-referential';

try {
  process.loadEnvFile();
} catch {
  // .env is absent — variables come from the environment (e.g. CI).
}

async function main(): Promise<void> {
  const dbName = e2eDbName(process.env.DB_NAME);
  await prepareDatabase(dbName);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrlFromEnv({
        ...process.env,
        DB_NAME: dbName,
      }),
    }),
  });
  try {
    await seedE2eReferential(prisma);
    console.log(`E2E database ${dbName} is ready.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Driver and config messages only: the referential holds no personal data.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
