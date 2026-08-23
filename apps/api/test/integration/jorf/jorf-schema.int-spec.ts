import { PrismaClient } from 'src/generated/prisma/client';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client';
import { arreteData } from 'test/helpers/arrete';
import { commune } from 'test/helpers/commune';

// Schema-level guarantees of the jorf-monitor migration: docs/research/jorf-monitor.md,
// docs/research/data-model.md § 4.
describe('Arrete / ArreteEntry / JorfDelta / MonitorAlert schema (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Arrete", "Commune", "JorfDelta" CASCADE`;
  });

  async function createCommune(codeInsee: string) {
    return prisma.commune.create({
      data: commune(codeInsee, 'Nîmes', '30', 'Gard'),
    });
  }

  function entryData(
    overrides: Partial<{
      codeInsee: string | null;
      risque: string;
      eventStart: Date;
      eventEnd: Date;
    }> = {},
  ) {
    return {
      codeInsee: overrides.codeInsee === undefined ? null : overrides.codeInsee,
      communeLabelRaw: 'Nîmes',
      departementRaw: 'Gard',
      risque: overrides.risque ?? 'Inondations et coulées de boue',
      eventStart: overrides.eventStart ?? new Date('2026-05-01'),
      eventEnd: overrides.eventEnd ?? new Date('2026-05-02'),
      outcome: 'RECONNU' as const,
      motivation: null,
    };
  }

  it('inserts an arrêté with entries for both annexes', async () => {
    const commune = await createCommune('30189');
    const arrete = await prisma.arrete.create({
      data: {
        ...arreteData(),
        entries: {
          create: [
            entryData({ codeInsee: commune.codeInsee, risque: 'Inondations' }),
            {
              ...entryData({ risque: 'Sécheresse' }),
              outcome: 'REFUSE',
              motivation: 'Aléa non caractérisé sur la commune',
            },
          ],
        },
      },
      include: { entries: true },
    });

    expect(arrete.entries).toHaveLength(2);
  });

  it('cascades: deleting an Arrete removes its entries', async () => {
    const arrete = await prisma.arrete.create({
      data: { ...arreteData(), entries: { create: [entryData()] } },
    });

    await prisma.arrete.delete({ where: { id: arrete.id } });

    const remaining = await prisma.arreteEntry.findMany({
      where: { arreteId: arrete.id },
    });
    expect(remaining).toEqual([]);
  });

  it('rejects a duplicate (arreteId, codeInsee, risque, eventStart, eventEnd) when codeInsee is matched', async () => {
    const commune = await createCommune('30189');
    const arrete = await prisma.arrete.create({ data: arreteData() });
    const data = entryData({ codeInsee: commune.codeInsee });
    await prisma.arreteEntry.create({ data: { ...data, arreteId: arrete.id } });

    await expect(
      prisma.arreteEntry.create({ data: { ...data, arreteId: arrete.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows two unmatched entries with an otherwise-duplicate key (codeInsee: null)', async () => {
    const arrete = await prisma.arrete.create({ data: arreteData() });
    const data = entryData({ codeInsee: null });
    await prisma.arreteEntry.create({ data: { ...data, arreteId: arrete.id } });

    await expect(
      prisma.arreteEntry.create({ data: { ...data, arreteId: arrete.id } }),
    ).resolves.toBeDefined();
  });

  it('deduplicates a NOR via the unique constraint', async () => {
    await prisma.arrete.create({ data: arreteData({ nor: 'INTE2600001A' }) });

    await expect(
      prisma.arrete.create({ data: arreteData({ nor: 'INTE2600001A' }) }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('records a processed JorfDelta by file name', async () => {
    const fileName = 'JORFSIMPLE_20260613-060000.tar.gz';
    const delta = await prisma.jorfDelta.create({
      data: { fileName, processedAt: new Date('2026-06-13T06:05:00Z') },
    });

    expect(delta.fileName).toBe(fileName);

    await expect(
      prisma.jorfDelta.create({
        data: { fileName, processedAt: new Date() },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it.each([
    'UNPARSEABLE_ANNEXE',
    'UNMATCHED_COMMUNE',
    'OUTCOME_CHANGED',
  ] as const)('inserts a MonitorAlert of kind %s', async (kind) => {
    const alert = await prisma.monitorAlert.create({
      data: { kind, detail: 'NOR INTE2600001A' },
    });

    expect(alert.kind).toBe(kind);
    expect(alert.arreteId).toBeNull();
  });

  it('keeps a MonitorAlert after its arrêté is deleted', async () => {
    const arrete = await prisma.arrete.create({ data: arreteData() });
    const alert = await prisma.monitorAlert.create({
      data: {
        kind: 'UNMATCHED_COMMUNE',
        detail: 'commune inconnue',
        arreteId: arrete.id,
      },
    });

    await prisma.arrete.delete({ where: { id: arrete.id } });

    const remaining = await prisma.monitorAlert.findUnique({
      where: { id: alert.id },
    });
    expect(remaining).toMatchObject({ id: alert.id, arreteId: null });
  });
});
