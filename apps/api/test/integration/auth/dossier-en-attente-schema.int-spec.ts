import { PrismaClient } from 'src/generated/prisma/client.js';
import { commune } from 'test/helpers/commune.js';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client.js';
import { userData } from 'test/helpers/user-data.js';

// Schema-level guarantees of the DossierEnAttente migration:
// docs/research/dossier-preliminaire.md, «Три параметра до подтверждения»,
// docs/research/data-model.md § 5, § 7.
describe('DossierEnAttente schema (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune" CASCADE`;
  });

  async function createUserAndCommune() {
    const user = await prisma.user.create({ data: userData() });
    const row = await prisma.commune.create({
      data: commune('30189', 'Nîmes', '30', 'Gard'),
    });
    return { user, commune: row };
  }

  function dossierData(userId: string, codeInsee: string) {
    return {
      userId,
      codeInsee,
      risque: 'INONDATION' as const,
      eventDate: new Date('2026-10-05'),
    };
  }

  it('cascades: deleting a User removes its DossierEnAttente row', async () => {
    const { user, commune: row } = await createUserAndCommune();
    await prisma.dossierEnAttente.create({
      data: dossierData(user.id, row.codeInsee),
    });

    await prisma.user.delete({ where: { id: user.id } });

    const remaining = await prisma.dossierEnAttente.findMany({
      where: { userId: user.id },
    });
    expect(remaining).toEqual([]);
  });

  it('rejects a second row for the same user: userId is the primary key', async () => {
    const { user, commune: row } = await createUserAndCommune();
    await prisma.dossierEnAttente.create({
      data: dossierData(user.id, row.codeInsee),
    });

    await expect(
      prisma.dossierEnAttente.create({
        data: {
          ...dossierData(user.id, row.codeInsee),
          risque: 'SECHERESSE',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('restricts deletion of a Commune referenced by a DossierEnAttente', async () => {
    const { user, commune: row } = await createUserAndCommune();
    await prisma.dossierEnAttente.create({
      data: dossierData(user.id, row.codeInsee),
    });

    await expect(
      prisma.commune.delete({ where: { codeInsee: row.codeInsee } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
