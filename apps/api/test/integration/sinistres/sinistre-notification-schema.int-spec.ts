import { PrismaClient } from 'src/generated/prisma/client';
import { arreteData } from 'test/helpers/arrete';
import { commune } from 'test/helpers/commune';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client';
import { userData } from 'test/helpers/user-data';

// Schema-level guarantees of the SinistreNotification outbox migration:
// docs/research/data-model.md § 5, docs/research/sinistre-plan.md, «Схема:
// Sinistre, Step, StepTemplate, SinistreNotification».
describe('SinistreNotification schema (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune", "Arrete" CASCADE`;
  });

  async function createSinistre() {
    const user = await prisma.user.create({ data: userData() });
    const codeInsee = '30189';
    await prisma.commune.create({
      data: commune(codeInsee, 'Nîmes', '30', 'Gard'),
    });
    return prisma.sinistre.create({
      data: {
        userId: user.id,
        codeInsee,
        risque: 'INONDATION',
        eventDate: new Date('2026-06-15'),
        declarationDate: null,
        status: 'AVANT_ARRETE',
      },
    });
  }

  it('creates a pending outbox row with sentAt null', async () => {
    const sinistre = await createSinistre();
    const arrete = await prisma.arrete.create({ data: arreteData() });

    const notification = await prisma.sinistreNotification.create({
      data: {
        sinistreId: sinistre.id,
        arreteId: arrete.id,
        kind: 'PUBLICATION',
      },
    });

    expect(notification.sentAt).toBeNull();
  });

  it('allows two rows for the same (sinistre, arrêté) with different kind', async () => {
    const sinistre = await createSinistre();
    const arrete = await prisma.arrete.create({ data: arreteData() });
    await prisma.sinistreNotification.create({
      data: {
        sinistreId: sinistre.id,
        arreteId: arrete.id,
        kind: 'PUBLICATION',
      },
    });

    await expect(
      prisma.sinistreNotification.create({
        data: {
          sinistreId: sinistre.id,
          arreteId: arrete.id,
          kind: 'RECTIFICATIF_RECONNU',
        },
      }),
    ).resolves.toMatchObject({ kind: 'RECTIFICATIF_RECONNU' });
  });

  it('rejects a second row for the same (sinistre, arrêté, kind) via the unique index', async () => {
    const sinistre = await createSinistre();
    const arrete = await prisma.arrete.create({ data: arreteData() });
    await prisma.sinistreNotification.create({
      data: {
        sinistreId: sinistre.id,
        arreteId: arrete.id,
        kind: 'PUBLICATION',
      },
    });

    await expect(
      prisma.sinistreNotification.create({
        data: {
          sinistreId: sinistre.id,
          arreteId: arrete.id,
          kind: 'PUBLICATION',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cascades: deleting a Sinistre removes its SinistreNotification rows', async () => {
    const sinistre = await createSinistre();
    const arrete = await prisma.arrete.create({ data: arreteData() });
    await prisma.sinistreNotification.create({
      data: {
        sinistreId: sinistre.id,
        arreteId: arrete.id,
        kind: 'PUBLICATION',
      },
    });

    await prisma.sinistre.delete({ where: { id: sinistre.id } });

    const remaining = await prisma.sinistreNotification.findMany({
      where: { arreteId: arrete.id },
    });
    expect(remaining).toEqual([]);
  });

  it('restricts deletion of an Arrete referenced by a pending notification', async () => {
    const sinistre = await createSinistre();
    const arrete = await prisma.arrete.create({ data: arreteData() });
    await prisma.sinistreNotification.create({
      data: {
        sinistreId: sinistre.id,
        arreteId: arrete.id,
        kind: 'PUBLICATION',
      },
    });

    // Driver adapter renumbers the RESTRICT violation to P2039, not the
    // classic P2003 — apps/api/src/veille/veille-schema.int-spec.ts.
    await expect(
      prisma.arrete.delete({ where: { id: arrete.id } }),
    ).rejects.toMatchObject({ code: 'P2039' });
  });
});
