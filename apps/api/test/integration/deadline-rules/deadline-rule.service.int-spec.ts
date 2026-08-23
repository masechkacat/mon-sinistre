import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'test/helpers/app';
import { deadlineRuleData } from 'test/helpers/deadline-rule';
import { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service';
import { PrismaService } from 'src/prisma/prisma.service';

// DeadlineRuleService.resolveActive — the one query "which DeadlineRule is
// active for this code/anchor on this date" every caller resolves through
// (docs/research/sinistre-plan.md, «Резолв правила по дате якоря», issue #148).
describe('DeadlineRuleService.resolveActive (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let service: DeadlineRuleService;

  beforeAll(async () => {
    app = await createIntTestApp();
    prisma = app.get(PrismaService);
    service = app.get(DeadlineRuleService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "DeadlineRule" CASCADE`;
  });

  it('returns the rule active on the given date', async () => {
    await prisma.deadlineRule.create({
      data: deadlineRuleData({ duration: 30 }),
    });

    const rule = await service.resolveActive(
      'DECLARATION_ASSUREUR',
      'DATE_PUBLICATION_ARRETE',
      new Date('2026-07-01'),
    );

    expect(rule.duration).toBe(30);
    expect(rule.unit).toBe('DAYS');
  });

  it('picks the version effective on the date when several versions exist', async () => {
    await prisma.deadlineRule.create({
      data: deadlineRuleData({
        duration: 30,
        effectiveFrom: new Date('2023-01-01'),
        effectiveTo: new Date('2026-08-17'),
      }),
    });
    await prisma.deadlineRule.create({
      data: deadlineRuleData({
        duration: 45,
        effectiveFrom: new Date('2026-08-18'),
        effectiveTo: null,
      }),
    });

    const rule = await service.resolveActive(
      'DECLARATION_ASSUREUR',
      'DATE_PUBLICATION_ARRETE',
      new Date('2026-08-18'),
    );

    expect(rule.duration).toBe(45);
  });

  it('includes a rule on its effectiveTo date, not just up to it', async () => {
    await prisma.deadlineRule.create({
      data: deadlineRuleData({
        duration: 30,
        effectiveFrom: new Date('2023-01-01'),
        effectiveTo: new Date('2026-08-17'),
      }),
    });

    const rule = await service.resolveActive(
      'DECLARATION_ASSUREUR',
      'DATE_PUBLICATION_ARRETE',
      new Date('2026-08-17'),
    );

    expect(rule.duration).toBe(30);
  });

  it('throws when no rule is active on the given date', async () => {
    await expect(
      service.resolveActive(
        'DECLARATION_ASSUREUR',
        'DATE_PUBLICATION_ARRETE',
        new Date('2026-07-01'),
      ),
    ).rejects.toThrow();
  });

  it('throws when a rule exists for the code but on a different anchor', async () => {
    await prisma.deadlineRule.create({
      data: deadlineRuleData({ anchor: 'DATE_DECLARATION' }),
    });

    await expect(
      service.resolveActive(
        'DECLARATION_ASSUREUR',
        'DATE_PUBLICATION_ARRETE',
        new Date('2026-07-01'),
      ),
    ).rejects.toThrow();
  });
});
