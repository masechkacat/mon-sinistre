import { PrismaClient } from 'src/generated/prisma/client';
import { createIntTestPrismaClient } from 'src/prisma/prisma-client.int-helper';
import { userData } from 'src/auth/user-data.test-helper';

// Schema-level guarantees of the User / RefreshToken migration:
// docs/research/user-account.md, docs/research/data-model.md § 5.
describe('User / RefreshToken schema (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "RefreshToken" CASCADE`;
  });

  it('rejects a second account for the same email via the unique index', async () => {
    await prisma.user.create({
      data: userData({ email: 'unique@example.fr' }),
    });

    await expect(
      prisma.user.create({ data: userData({ email: 'unique@example.fr' }) }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cascades: deleting a User removes its RefreshToken rows', async () => {
    const user = await prisma.user.create({ data: userData() });
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: `refresh-${Math.random()}`,
        expiresAt: new Date('2026-09-21'),
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const remaining = await prisma.refreshToken.findMany({
      where: { userId: user.id },
    });
    expect(remaining).toEqual([]);
  });
});
