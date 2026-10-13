import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from 'src/generated/prisma/client.js';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client.js';

/** The partial index `codesMergedInto` walks lives only in its migration
 * (data-model.md § 3); as with `nameNormalized`, this suite is what notices a
 * later migration dropping it. */
describe('Commune.successorCodeInsee index migration (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('indexes successorCodeInsee with a btree over the rows that carry one', async () => {
    const indexes = await prisma.$queryRaw<
      { indexdef: string }[]
    >`SELECT indexdef FROM pg_indexes
       WHERE tablename = 'Commune'
         AND indexname = 'Commune_successorCodeInsee_idx'`;

    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexdef).toContain('USING btree');
    expect(indexes[0]?.indexdef).toContain('("successorCodeInsee")');
    expect(indexes[0]?.indexdef).toContain(
      'WHERE ("successorCodeInsee" IS NOT NULL)',
    );
  });
});
