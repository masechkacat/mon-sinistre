import { PrismaClient } from 'src/generated/prisma/client';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client';
import {
  CATNAT_PLAN_KEY,
  seedStepTemplates,
  STEP_TEMPLATE_SEED,
} from 'src/step-templates/step-template.seed';

// seedStepTemplates idempotency (issue #148) — the schema-level guarantees
// (unique (planKey, order), both-empty rows saving) live in
// test/integration/sinistres/sinistre-schema.int-spec.ts.
describe('seedStepTemplates (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "StepTemplate" CASCADE`;
  });

  it('seeds the thirteen CATNAT steps, idempotently', async () => {
    await seedStepTemplates(prisma);
    await seedStepTemplates(prisma);

    const rows = await prisma.stepTemplate.findMany({
      where: { planKey: CATNAT_PLAN_KEY },
    });
    expect(rows).toHaveLength(STEP_TEMPLATE_SEED.length);

    for (const expected of STEP_TEMPLATE_SEED) {
      const matches = rows.filter((row) => row.order === expected.order);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        name: expected.name,
        anchor: expected.anchor,
        offsetDays: expected.offsetDays,
        deadlineRuleCode: expected.deadlineRuleCode,
      });
    }
  });

  it('re-running the seed edits rows in place rather than duplicating them after a text change', async () => {
    await seedStepTemplates(prisma);
    const firstRun = await prisma.stepTemplate.findFirstOrThrow({
      where: { planKey: CATNAT_PLAN_KEY, order: 1 },
    });

    await prisma.stepTemplate.update({
      where: { id: firstRun.id },
      data: { name: 'Texte modifié à la main' },
    });
    await seedStepTemplates(prisma);

    const rows = await prisma.stepTemplate.findMany({
      where: { planKey: CATNAT_PLAN_KEY, order: 1 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(firstRun.id);
    expect(rows[0]?.name).toBe(STEP_TEMPLATE_SEED[0]?.name);
  });
});
