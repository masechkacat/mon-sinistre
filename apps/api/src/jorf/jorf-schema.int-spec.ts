import { PrismaClient } from 'src/generated/prisma/client';
import { createIntTestPrismaClient } from 'src/prisma/prisma-client.int-helper';

// Schema-level guarantees of the jorf-monitor migration: docs/research/jorf-monitor.md,
// docs/research/data-model.md § 4.
describe('Arrete / ArreteEntry / JorfDelta schema (integration)', () => {
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
      data: {
        codeInsee,
        name: 'Nîmes',
        departementCode: '30',
        departementName: 'Gard',
        sourceUrl: 'https://geo.api.gouv.fr/communes',
        sourceVerifiedAt: new Date('2026-08-15'),
      },
    });
  }

  function arreteData(overrides: Partial<{ nor: string }> = {}) {
    return {
      nor: overrides.nor ?? `INTE${Math.random()}`,
      signedAt: new Date('2026-06-10'),
      publishedAt: new Date('2026-06-12'),
      jorfNumber: 'JORF n°0137 du 13 juin 2026',
      legifranceUrl:
        'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054245373',
      firstSeenAt: new Date('2026-06-13T06:00:00Z'),
      lastSeenAt: new Date('2026-06-13T06:00:00Z'),
      contentHash: 'hash-1',
    };
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
});
