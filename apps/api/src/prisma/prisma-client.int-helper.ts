import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'src/generated/prisma/client';
import { databaseUrlFromEnv } from 'src/prisma/database-url-from-env';

/**
 * For integration specs that do not bootstrap Nest. Specs that do take
 * PrismaService from the container instead.
 *
 * Callers own the lifecycle: `$disconnect()` in `afterAll`, or the jest run
 * hangs on the open pool.
 */
export const createIntTestPrismaClient = (): PrismaClient =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrlFromEnv() }),
  });
