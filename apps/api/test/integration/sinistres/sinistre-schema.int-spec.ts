import { PrismaClient } from 'src/generated/prisma/client';
import { arreteData, arreteEntryData } from 'test/helpers/arrete';
import { commune } from 'test/helpers/commune';
import { deadlineRuleData } from 'test/helpers/deadline-rule';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client';
import { createSinistre, sinistreData } from 'test/helpers/sinistre';
import { userData } from 'test/helpers/user-data';

// Schema-level guarantees of the Sinistre / Step / StepTemplate migration:
// docs/research/data-model.md § 3, § 5, docs/research/sinistre-plan.md,
// «Схема: Sinistre, Step, StepTemplate, SinistreNotification».
describe('Sinistre / Step / StepTemplate schema (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune", "Arrete", "DeadlineRule", "StepTemplate" CASCADE`;
  });

  async function createCommune(codeInsee: string) {
    return prisma.commune.create({
      data: commune(codeInsee, 'Nîmes', '30', 'Gard'),
    });
  }

  it('cascades: deleting a User removes its Sinistre and Step rows', async () => {
    const { user, sinistre } = await createSinistre(prisma);
    await prisma.step.create({
      data: {
        sinistreId: sinistre.id,
        name: 'Photographier',
        description: 'Avant nettoyage',
        anchor: 'DATE_SINISTRE',
        offsetDays: 0,
        fromTemplate: true,
        order: 1,
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const remainingSinistres = await prisma.sinistre.findMany({
      where: { userId: user.id },
    });
    const remainingSteps = await prisma.step.findMany({
      where: { sinistreId: sinistre.id },
    });
    expect(remainingSinistres).toEqual([]);
    expect(remainingSteps).toEqual([]);
  });

  it('restricts deletion of a DeadlineRule referenced by a Step', async () => {
    const { sinistre } = await createSinistre(prisma);
    const rule = await prisma.deadlineRule.create({
      data: deadlineRuleData(),
    });
    await prisma.step.create({
      data: {
        sinistreId: sinistre.id,
        name: 'Déclarer le sinistre',
        description: '',
        deadlineRuleId: rule.id,
        fromTemplate: true,
        order: 1,
      },
    });

    await expect(
      prisma.deadlineRule.delete({ where: { id: rule.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('restricts deletion of an ArreteEntry referenced by a Sinistre', async () => {
    const user = await prisma.user.create({ data: userData() });
    const commune = await createCommune('30189');
    const arrete = await prisma.arrete.create({
      data: {
        ...arreteData(),
        entries: {
          create: [arreteEntryData(commune.codeInsee)],
        },
      },
      include: { entries: true },
    });
    const entry = arrete.entries[0]!;
    await prisma.sinistre.create({
      data: sinistreData({
        userId: user.id,
        codeInsee: commune.codeInsee,
        arreteEntryId: entry.id,
      }),
    });

    await expect(
      prisma.arreteEntry.delete({ where: { id: entry.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects a duplicate (planKey, order) via the unique index', async () => {
    const templateData = {
      planKey: 'CATNAT',
      name: 'Photographier',
      description: 'Avant nettoyage',
      anchor: 'DATE_SINISTRE' as const,
      offsetDays: 0,
      required: true,
      order: 1,
    };
    await prisma.stepTemplate.create({ data: templateData });

    await expect(
      prisma.stepTemplate.create({
        data: { ...templateData, name: 'Autre nom' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('saves a StepTemplate row with both offsetDays and deadlineRuleCode empty (a reminder step)', async () => {
    const template = await prisma.stepTemplate.create({
      data: {
        planKey: 'CATNAT',
        name: "Transmettre l'état estimatif",
        description: '',
        anchor: 'DATE_DECLARATION',
        offsetDays: null,
        deadlineRuleCode: null,
        required: true,
        order: 9,
      },
    });

    expect(template.offsetDays).toBeNull();
    expect(template.deadlineRuleCode).toBeNull();
  });
});
