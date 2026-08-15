import { PrismaClient } from 'src/generated/prisma/client';
import { createIntTestPrismaClient } from 'src/prisma/prisma-client.int-helper';

// Schema-level guarantees of the veille migration:
// docs/research/veille-subscription-lifecycle.md.
describe('Veille / VeilleCommune schema (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Veille", "Commune", "VeilleFormEmail" CASCADE`;
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

  function veilleData(overrides: Partial<{ email: string }> = {}) {
    return {
      email: overrides.email ?? 'riverain@example.fr',
      confirmTokenHash: `confirm-${Math.random()}`,
      unsubscribeTokenHash: `unsubscribe-${Math.random()}`,
      confirmExpiresAt: new Date('2026-08-22'),
    };
  }

  it('cascades: deleting a Veille removes its VeilleCommune rows', async () => {
    const commune = await createCommune('30189');
    const veille = await prisma.veille.create({
      data: {
        ...veilleData(),
        communes: { create: [{ codeInsee: commune.codeInsee }] },
      },
    });

    await prisma.veille.delete({ where: { id: veille.id } });

    const remaining = await prisma.veilleCommune.findMany({
      where: { veilleId: veille.id },
    });
    expect(remaining).toEqual([]);
  });

  it('rejects a second subscription for the same email via the unique index', async () => {
    await prisma.veille.create({
      data: veilleData({ email: 'unique@example.fr' }),
    });

    await expect(
      prisma.veille.create({
        data: veilleData({ email: 'unique@example.fr' }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('restricts deletion of a Commune referenced by a subscription', async () => {
    const commune = await createCommune('30007');
    await prisma.veille.create({
      data: {
        ...veilleData(),
        communes: { create: [{ codeInsee: commune.codeInsee }] },
      },
    });

    // Prisma 7's driver adapter wraps the raw Postgres error (SQLSTATE 23001,
    // RESTRICT violation) as P2039 rather than the classic P2003.
    await expect(
      prisma.commune.delete({ where: { codeInsee: commune.codeInsee } }),
    ).rejects.toMatchObject({ code: 'P2039' });
  });
});
