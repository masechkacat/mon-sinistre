import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StepKind } from '@mon-sinistre/contracts';
import { PrismaClient } from 'src/generated/prisma/client.js';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client.js';
import { createSinistre } from 'test/helpers/sinistre.js';

const MIGRATIONS_DIR = join(import.meta.dirname, '../../../prisma/migrations');

/**
 * The backfill statements of the migration, read from the file Prisma
 * checksummed when it applied them: re-running them on a row in its
 * pre-backfill state is the only way to test the backfill itself, since the
 * test database is created by the very migrations under test. Copying the SQL
 * into the spec would test the copy instead.
 */
function backfillStatements(): string[] {
  const dir = readdirSync(MIGRATIONS_DIR).find((name) =>
    name.endsWith('_add_step_kind'),
  );
  if (dir === undefined) throw new Error('migration add_step_kind not found');
  return (
    readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf-8')
      // Comments go first: they may carry semicolons of their own.
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.toUpperCase().startsWith('UPDATE'))
  );
}

// Schema-level guarantees of the add_step_kind migration:
// docs/research/data-model.md § 3, § 4, § 5,
// docs/research/dossier-preliminaire.md, «Вид шага».
describe('add_step_kind migration (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune", "StepTemplate" CASCADE`;
  });

  it('defaults a StepTemplate inserted without kind to ACTION', async () => {
    const template = await prisma.stepTemplate.create({
      data: {
        planKey: 'CATNAT',
        name: "Limiter l'aggravation des dégâts",
        description: '',
        anchor: 'DATE_SINISTRE',
        offsetDays: 0,
        required: true,
        order: 3,
      },
    });

    expect(template.kind).toBe(StepKind.ACTION);
  });

  it('backfills the kind of the plan copies of a sinistre created before the migration', async () => {
    const { sinistre } = await createSinistre(prisma);
    // A row inserted without `kind` holds what the plan copies of an older
    // sinistre held right after ADD COLUMN: the column default.
    const insertStep = (order: number, fromTemplate = true) =>
      prisma.$executeRaw`
        INSERT INTO "Step" ("sinistreId", "name", "description", "anchor", "offsetDays", "fromTemplate", "order")
        VALUES (${sinistre.id}::uuid, ${`Étape ${order}`}, '', 'DATE_SINISTRE', 0, ${fromTemplate}, ${order})`;
    for (const order of [1, 2, 5, 7, 9]) await insertStep(order);
    await insertStep(1, false);

    for (const statement of backfillStatements())
      await prisma.$executeRawUnsafe(statement);

    const steps = await prisma.step.findMany({
      where: { sinistreId: sinistre.id },
      orderBy: [{ order: 'asc' }, { fromTemplate: 'desc' }],
      select: { order: true, fromTemplate: true, kind: true },
    });
    expect(steps).toEqual([
      { order: 1, fromTemplate: true, kind: StepKind.PHOTOS },
      { order: 1, fromTemplate: false, kind: StepKind.ACTION },
      { order: 2, fromTemplate: true, kind: StepKind.ACTION },
      { order: 5, fromTemplate: true, kind: StepKind.JUSTIFICATIFS },
      { order: 7, fromTemplate: true, kind: StepKind.DECLARATION },
      { order: 9, fromTemplate: true, kind: StepKind.OBJETS },
    ]);
  });

  it('indexes ArreteEntry(codeInsee) for the lookup of arrêtés by commune', async () => {
    const indexes = await prisma.$queryRaw<
      { indexdef: string }[]
    >`SELECT indexdef FROM pg_indexes
       WHERE tablename = 'ArreteEntry'
         AND indexname = 'ArreteEntry_codeInsee_idx'`;

    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexdef).toContain('USING btree ("codeInsee")');
  });
});
