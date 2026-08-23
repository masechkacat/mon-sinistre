import type { PrismaClient, Prisma } from 'src/generated/prisma/client';

/**
 * Serialises the per-address rate counters (`count`-then-`create`) against
 * concurrent requests for the same address. Without it the pair is not
 * atomic: N requests read the same pre-limit count, all pass it, and a
 * pipelined burst overshoots the limit by its own size — which for
 * `LoginAttempt` is that many extra password guesses. `pg_advisory_xact_lock`
 * over a row lock because there is no row to lock: the counters are
 * insert-only tables with no per-address parent, and the address itself is
 * never stored. The lock is released by the commit, and it is taken on
 * `hashtext` of the already-hashed address — 32 bits, so a collision costs
 * two unrelated addresses the microseconds of each other's count and insert,
 * nothing more.
 *
 * `fn` must do its writes through the `tx` it is handed: work sent to the
 * client outside it runs on another connection, outside both the lock and the
 * rollback.
 */
export function withAddressLock<T>(
  prisma: PrismaClient,
  emailHash: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${emailHash})::bigint)`;
    return fn(tx);
  });
}
