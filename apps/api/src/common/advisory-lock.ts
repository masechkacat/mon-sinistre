import type { PrismaClient, Prisma } from 'src/generated/prisma/client';

/**
 * Serialises a read-then-write against concurrent requests for the same
 * `key` where there is no row to lock. The lock is released by the commit,
 * and it is taken on `hashtext(key)` — 32 bits, so a collision costs two
 * unrelated keys the microseconds of each other's transaction, nothing more.
 *
 * `fn` must do its reads and writes through the `tx` it is handed: work sent
 * to the client outside it runs on another connection, outside both the lock
 * and the rollback.
 */
export function withAdvisoryLock<T>(
  prisma: PrismaClient,
  key: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
    return fn(tx);
  });
}
