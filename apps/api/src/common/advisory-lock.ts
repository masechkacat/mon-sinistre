import type { PrismaClient, Prisma } from 'src/generated/prisma/client.js';

/**
 * Serialises a read-then-write against concurrent requests for the same
 * `key` where there is no row to lock, inside a transaction the caller has
 * already opened: the lock is released by *that* transaction's commit, so a
 * caller that rolls back takes the locked work with it. It is taken on
 * `hashtext(key)` — 32 bits, so a collision costs two unrelated keys the
 * microseconds of each other's transaction, nothing more.
 *
 * `fn` must do its reads and writes through the `tx` it is handed: work sent
 * to the client outside it runs on another connection, outside both the lock
 * and the rollback.
 */
export async function withAdvisoryLockIn<T>(
  tx: Prisma.TransactionClient,
  key: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
  return fn(tx);
}

/**
 * The same lock for a caller holding no transaction: one is opened around it.
 * Which of the two a caller needs is decided statically, not by sniffing the
 * client it was handed — a transaction client keeps a `$transaction` method
 * that nests a *second* transaction rather than refusing, and the recursion
 * only shows up as a `P2028` timeout.
 */
export function withAdvisoryLock<T>(
  prisma: PrismaClient,
  key: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction((tx) => withAdvisoryLockIn(tx, key, fn));
}
