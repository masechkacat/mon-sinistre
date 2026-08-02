import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'src/generated/prisma/client';
import { buildDatabaseUrl } from 'src/prisma/database-url';
import { normalizeCommuneName } from './normalize-commune-name';

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set for integration tests`);
  }
  return value;
};

/**
 * The migration that carries the search key, checked against the real schema:
 * the column is added nullable (the backfill is a rerun of the idempotent
 * import, not SQL in the migration — docs/research/commune-referential.md),
 * and the prefix index carries the text_pattern_ops operator class. Prisma
 * does not read that class back from the database, so a later `migrate dev`
 * keeps proposing an equivalent DROP+CREATE for this index — this suite is
 * what notices if such a block ever lands as a plain DROP.
 */
describe('Commune.nameNormalized migration (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: buildDatabaseUrl({
          host: requiredEnv('DB_HOST'),
          port: requiredEnv('DB_PORT'),
          user: requiredEnv('DB_USER'),
          password: requiredEnv('DB_PASSWORD'),
          database: requiredEnv('DB_NAME'),
        }),
      }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Commune" CASCADE`;
  });

  it('adds nameNormalized as a nullable text column', async () => {
    const columns = await prisma.$queryRaw<
      { data_type: string; is_nullable: string }[]
    >`SELECT data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'Commune' AND column_name = 'nameNormalized'`;

    // Nullable on purpose: rows imported before this migration have no search
    // key yet. NOT NULL comes as a separate migration once the import fills
    // the column and has been rerun.
    expect(columns).toEqual([{ data_type: 'text', is_nullable: 'YES' }]);
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
