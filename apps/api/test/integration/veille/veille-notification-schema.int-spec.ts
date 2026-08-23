import { PrismaClient } from 'src/generated/prisma/client';
import { arreteData } from 'src/jorf/arrete.test-helper';
import { createIntTestPrismaClient } from 'src/prisma/prisma-client.int-helper';
import { veilleData } from 'src/veille/veille.test-helper';

// Schema-level guarantees of the VeilleNotification outbox migration:
// docs/research/data-model.md § 6, docs/plan/jorf-monitor.md, Фаза 3.
describe('VeilleNotification schema (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Veille", "Arrete" CASCADE`;
  });

  it('creates a pending outbox row with sentAt null', async () => {
    const veille = await prisma.veille.create({ data: veilleData() });
    const arrete = await prisma.arrete.create({ data: arreteData() });

    const notification = await prisma.veilleNotification.create({
      data: { veilleId: veille.id, arreteId: arrete.id },
    });

    expect(notification.sentAt).toBeNull();
  });

  it('rejects a second notification for the same (veille, arrêté) via the unique index', async () => {
    const veille = await prisma.veille.create({ data: veilleData() });
    const arrete = await prisma.arrete.create({ data: arreteData() });
    await prisma.veilleNotification.create({
      data: { veilleId: veille.id, arreteId: arrete.id },
    });

    await expect(
      prisma.veilleNotification.create({
        data: { veilleId: veille.id, arreteId: arrete.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cascades: deleting a Veille removes its VeilleNotification rows', async () => {
    const veille = await prisma.veille.create({ data: veilleData() });
    const arrete = await prisma.arrete.create({ data: arreteData() });
    await prisma.veilleNotification.create({
      data: { veilleId: veille.id, arreteId: arrete.id },
    });

    await prisma.veille.delete({ where: { id: veille.id } });

    const remaining = await prisma.veilleNotification.findMany({
      where: { arreteId: arrete.id },
    });
    expect(remaining).toEqual([]);
  });

  it('restricts deletion of an Arrete referenced by a pending notification', async () => {
    const veille = await prisma.veille.create({ data: veilleData() });
    const arrete = await prisma.arrete.create({ data: arreteData() });
    await prisma.veilleNotification.create({
      data: { veilleId: veille.id, arreteId: arrete.id },
    });

    // Driver adapter renumbers the RESTRICT violation to P2039, not the
    // classic P2003 — apps/api/src/veille/veille-schema.int-spec.ts.
    await expect(
      prisma.arrete.delete({ where: { id: arrete.id } }),
    ).rejects.toMatchObject({ code: 'P2039' });
  });
});
