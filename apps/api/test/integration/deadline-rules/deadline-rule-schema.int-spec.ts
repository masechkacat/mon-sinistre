import { PrismaClient } from 'src/generated/prisma/client';
import { createIntTestPrismaClient } from 'src/prisma/prisma-client.int-helper';
import { DEADLINE_RULE_SEED, seedDeadlineRules } from 'src/deadline-rules/deadline-rule.seed';

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

  function ruleData(
    overrides: Partial<{
      code: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    }> = {},
  ) {
    return {
      code: overrides.code ?? 'DECLARATION_ASSUREUR',
      duration: 30,
      unit: 'DAYS' as const,
      anchor: 'DATE_PUBLICATION_ARRETE' as const,
      effectiveFrom: overrides.effectiveFrom ?? new Date('2023-01-01'),
      effectiveTo:
        overrides.effectiveTo === undefined ? null : overrides.effectiveTo,
      sourceUrl:
        'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006792617/',
      sourceVerifiedAt: new Date('2026-08-18'),
    };
  }

  it('rejects a duplicate (code, effectiveFrom) via the unique index', async () => {
    await prisma.deadlineRule.create({ data: ruleData() });

    await expect(
      prisma.deadlineRule.create({ data: ruleData() }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects overlapping effective intervals of the same code', async () => {
    await prisma.deadlineRule.create({
      data: ruleData({
        effectiveFrom: new Date('2023-01-01'),
        effectiveTo: null,
      }),
    });

    // Closes the row above only from 2026-08-18, so the new version's start
    // (2026-08-01) still falls inside the still-open first interval.
    await expect(
      prisma.deadlineRule.create({
        data: ruleData({
          effectiveFrom: new Date('2026-08-01'),
          effectiveTo: null,
        }),
      }),
    ).rejects.toThrow();
  });

  it('allows a new version once the previous one is closed the day before', async () => {
    await prisma.deadlineRule.create({
      data: ruleData({
        effectiveFrom: new Date('2023-01-01'),
        effectiveTo: new Date('2026-08-17'),
      }),
    });

    await expect(
      prisma.deadlineRule.create({
        data: ruleData({
          effectiveFrom: new Date('2026-08-18'),
          effectiveTo: null,
        }),
      }),
    ).resolves.toBeDefined();
  });

  it('allows overlapping intervals for different codes', async () => {
    await prisma.deadlineRule.create({
      data: ruleData({ code: 'DECLARATION_ASSUREUR' }),
    });

    await expect(
      prisma.deadlineRule.create({ data: ruleData({ code: 'AUTRE_DELAI' }) }),
    ).resolves.toBeDefined();
  });

  it('seeds DECLARATION_ASSUREUR with a SourceReference, idempotently', async () => {
    await seedDeadlineRules(prisma);
    await seedDeadlineRules(prisma);

    const rows = await prisma.deadlineRule.findMany({
      where: { code: 'DECLARATION_ASSUREUR' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      duration: DEADLINE_RULE_SEED[0]?.duration,
      unit: DEADLINE_RULE_SEED[0]?.unit,
      anchor: DEADLINE_RULE_SEED[0]?.anchor,
      sourceUrl: DEADLINE_RULE_SEED[0]?.sourceUrl,
    });
    expect(rows[0]?.sourceVerifiedAt).toBeInstanceOf(Date);
  });
});
