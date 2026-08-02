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

  it('indexes nameNormalized with text_pattern_ops for prefix search', async () => {
    const indexes = await prisma.$queryRaw<
      { indexdef: string }[]
    >`SELECT indexdef FROM pg_indexes
       WHERE tablename = 'Commune'
         AND indexname = 'Commune_nameNormalized_prefix_idx'`;

    // A plain btree under a non-C collation does not serve LIKE 'q%'; the
    // access method and the column are asserted too, so that swapping the
    // index for a different one under the same name does not pass unnoticed.
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexdef).toContain('USING btree');
    expect(indexes[0]?.indexdef).toContain('"nameNormalized" text_pattern_ops');
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
