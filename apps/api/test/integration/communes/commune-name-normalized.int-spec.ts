import { PrismaClient } from 'src/generated/prisma/client';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client';
import { normalizeCommuneName } from 'src/communes/normalize-commune-name';

/**
 * The migration that carries the search key, checked against the real schema:
 * the column is NOT NULL (added nullable while the backfill — a rerun of the
 * idempotent import, not SQL in the migration — was still outstanding on
 * deployments; docs/research/commune-referential.md), and it is declared
 * `COLLATE "C"` so that a plain btree serves both the prefix LIKE and the
 * ORDER BY of the search.
 *
 * Prisma expresses neither the collation nor an operator class in the schema
 * and does not read them back from the database, so `migrate dev` will never
 * report their loss as drift: this suite is the only thing that notices if a
 * later migration recreates the column or the index without them.
 */
describe('Commune.nameNormalized migration (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Commune" CASCADE`;
  });

  it('requires nameNormalized on every row', async () => {
    const columns = await prisma.$queryRaw<
      { data_type: string; is_nullable: string }[]
    >`SELECT data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'Commune' AND column_name = 'nameNormalized'`;

    // NOT NULL is what makes a skipped `seed` after `migration:deploy`
    // impossible to miss: without it a row with no search key is invisible to
    // every search by name, and nothing fails loudly.
    expect(columns).toEqual([{ data_type: 'text', is_nullable: 'NO' }]);
  });

  it('declares nameNormalized COLLATE "C" so the sort order is portable', async () => {
    const columns = await prisma.$queryRaw<{ collation_name: string }[]>`
      SELECT collation_name
        FROM information_schema.columns
       WHERE table_name = 'Commune' AND column_name = 'nameNormalized'`;

    // Normalization strips case and accents but not punctuation, and that is
    // where collations disagree: glibc ignores a hyphen at the primary level,
    // musl and ICU do not, so "Saint-Étienne" and "Sainte-Marie" swap places
    // between postgres:18 and postgres:18-alpine. Byte order is the same
    // everywhere — this assertion is what keeps the search result identical
    // across deployments, and the sort test below meaningful in CI.
    expect(columns).toEqual([{ collation_name: 'C' }]);
  });

  it('indexes nameNormalized with a plain btree for prefix search', async () => {
    const indexes = await prisma.$queryRaw<
      { indexdef: string }[]
    >`SELECT indexdef FROM pg_indexes
       WHERE tablename = 'Commune'
         AND indexname = 'Commune_nameNormalized_idx'`;

    // Under COLLATE "C" a plain btree serves both LIKE 'q%' and ORDER BY, so
    // the text_pattern_ops operator class the first migration needed is gone.
    // The access method and the column are asserted too, so that swapping the
    // index for a different one under the same name does not pass unnoticed.
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexdef).toContain('USING btree');
    expect(indexes[0]?.indexdef).toContain('"nameNormalized"');
    expect(indexes[0]?.indexdef).not.toContain('text_pattern_ops');
  });

  it('stores the search key produced by normalizeCommuneName', async () => {
    await prisma.commune.create({
      data: {
        codeInsee: '02168',
        name: 'Château-Thierry',
        nameNormalized: normalizeCommuneName('Château-Thierry'),
        departementCode: '02',
        departementName: 'Aisne',
        sourceUrl: 'https://geo.api.gouv.fr/communes',
        sourceVerifiedAt: new Date('2026-08-02'),
      },
    });

    const stored = await prisma.commune.findUniqueOrThrow({
      where: { codeInsee: '02168' },
      select: { nameNormalized: true },
    });

    expect(stored.nameNormalized).toBe('chateau-thierry');
  });
});
