import { PrismaClient } from 'src/generated/prisma/client';
import { deadlineRuleData } from 'test/helpers/deadline-rule';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client';
import {
  DEADLINE_RULE_SEED,
  seedDeadlineRules,
} from 'src/deadline-rules/deadline-rule.seed';

// Schema-level guarantees of the DeadlineRule migration:
// docs/research/data-model.md § 3, docs/research/jorf-monitor.md,
// «DeadlineRule: срок déclaration».
describe('DeadlineRule schema (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "DeadlineRule" CASCADE`;
  });

  it('rejects a duplicate (code, effectiveFrom) via the unique index', async () => {
    await prisma.deadlineRule.create({ data: deadlineRuleData() });

    await expect(
      prisma.deadlineRule.create({ data: deadlineRuleData() }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects overlapping effective intervals of the same code', async () => {
    await prisma.deadlineRule.create({
      data: deadlineRuleData({
        effectiveFrom: new Date('2023-01-01'),
        effectiveTo: null,
      }),
    });

    // Closes the row above only from 2026-08-18, so the new version's start
    // (2026-08-01) still falls inside the still-open first interval.
    await expect(
      prisma.deadlineRule.create({
        data: deadlineRuleData({
          effectiveFrom: new Date('2026-08-01'),
          effectiveTo: null,
        }),
      }),
    ).rejects.toThrow();
  });

  it('allows a new version once the previous one is closed the day before', async () => {
    await prisma.deadlineRule.create({
      data: deadlineRuleData({
        effectiveFrom: new Date('2023-01-01'),
        effectiveTo: new Date('2026-08-17'),
      }),
    });

    await expect(
      prisma.deadlineRule.create({
        data: deadlineRuleData({
          effectiveFrom: new Date('2026-08-18'),
          effectiveTo: null,
        }),
      }),
    ).resolves.toBeDefined();
  });

  it('allows overlapping intervals for different codes', async () => {
    await prisma.deadlineRule.create({
      data: deadlineRuleData({ code: 'DECLARATION_ASSUREUR' }),
    });

    await expect(
      prisma.deadlineRule.create({
        data: deadlineRuleData({ code: 'AUTRE_DELAI' }),
      }),
    ).resolves.toBeDefined();
  });

  it('seeds every DeadlineRule row with a SourceReference, idempotently (issue #148)', async () => {
    await seedDeadlineRules(prisma);
    await seedDeadlineRules(prisma);

    const rows = await prisma.deadlineRule.findMany();
    expect(rows).toHaveLength(DEADLINE_RULE_SEED.length);

    for (const expected of DEADLINE_RULE_SEED) {
      const matches = rows.filter((row) => row.code === expected.code);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        duration: expected.duration,
        unit: expected.unit,
        anchor: expected.anchor,
        sourceUrl: expected.sourceUrl,
      });
      expect(matches[0]?.sourceVerifiedAt).toBeInstanceOf(Date);
    }
  });
});
