import { PrismaClient } from 'src/generated/prisma/client';
import { isForeignKeyViolation } from 'src/prisma/prisma-error';
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

  function veilleChangeData(overrides: Partial<{ veilleId: string }> = {}) {
    return {
      veilleId: overrides.veilleId ?? '',
      changeTokenHash: `change-${Math.random()}`,
      communeCodes: ['30189'],
      expiresAt: new Date('2026-08-24'),
    };
  }

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

  it('rejects a second VeilleChange for the same subscription via the unique index', async () => {
    const veille = await prisma.veille.create({ data: veilleData() });
    await prisma.veilleChange.create({
      data: veilleChangeData({ veilleId: veille.id }),
    });

    await expect(
      prisma.veilleChange.create({
        data: veilleChangeData({ veilleId: veille.id }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('upsert rewrites the single VeilleChange for a subscription', async () => {
    const veille = await prisma.veille.create({ data: veilleData() });
    const data = veilleChangeData({ veilleId: veille.id });
    await prisma.veilleChange.create({ data });

    const rewritten = { ...data, communeCodes: ['30007'] };
    await prisma.veilleChange.upsert({
      where: { veilleId: veille.id },
      create: rewritten,
      update: rewritten,
    });

    const rows = await prisma.veilleChange.findMany({
      where: { veilleId: veille.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.communeCodes).toEqual(['30007']);
  });

  // The race `upsertChangeRequest`'s docblock describes. Asserted through the
  // guard, not the bare code — RESTRICT above already shows the driver adapter
  // is free to renumber what Postgres raised.
  it('surfaces a vanished parent as the violation isForeignKeyViolation catches', async () => {
    const veille = await prisma.veille.create({ data: veilleData() });
    await prisma.veille.delete({ where: { id: veille.id } });
    const data = veilleChangeData({ veilleId: veille.id });

    const error: unknown = await prisma.veilleChange
      .upsert({ where: { veilleId: veille.id }, create: data, update: data })
      .catch((raised: unknown) => raised);

    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it('cascades: deleting a Veille removes its VeilleChange', async () => {
    const veille = await prisma.veille.create({ data: veilleData() });
    await prisma.veilleChange.create({
      data: veilleChangeData({ veilleId: veille.id }),
    });

    await prisma.veille.delete({ where: { id: veille.id } });

    const remaining = await prisma.veilleChange.findMany({
      where: { veilleId: veille.id },
    });
    expect(remaining).toEqual([]);
  });
});
