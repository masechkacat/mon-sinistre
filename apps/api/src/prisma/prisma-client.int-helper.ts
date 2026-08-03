import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'src/generated/prisma/client';
import { databaseUrlFromEnv } from 'src/prisma/database-url-from-env';

/**
 * A Prisma client for integration specs that do not bootstrap Nest — the
 * import service runs outside a Nest context by design, and the migration
 * specs only need raw SQL. `DB_NAME` already points at `${DB_NAME}_test` by
 * then (`test/jest.int.env.js`), so this connects where the global setup ran
 * the migrations.
 *
 * The `.int-helper.ts` suffix keeps this out of the production build
 * (`tsconfig.build.json`) and out of both jest configs: it is test-only code
 * living in `src/` so that the `src/*` path alias and `npm run lint` still
 * cover it.
 *
 * Specs that do bootstrap `AppModule` take `PrismaService` from the container
 * instead — one connection, and the env validation of the real application.
 *
 * Callers own the lifecycle: `$disconnect()` in `afterAll`, or the jest run
 * hangs on the open pool.
 */
export const createIntTestPrismaClient = (): PrismaClient =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrlFromEnv() }),
  });
