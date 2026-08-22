import { PrismaClient } from 'src/generated/prisma/client';
import { createIntTestPrismaClient } from 'src/prisma/prisma-client.int-helper';
import { userData } from './user-data.test-helper';

// Schema-level guarantees of the PasswordReset migration:
// docs/research/user-account.md, docs/research/data-model.md § 5.
describe('PasswordReset schema (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "PasswordReset" CASCADE`;
  });

  it('cascades: deleting a User removes its PasswordReset rows', async () => {
    const user = await prisma.user.create({ data: userData() });
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: `reset-${Math.random()}`,
        expiresAt: new Date('2026-08-24'),
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const remaining = await prisma.passwordReset.findMany({
      where: { userId: user.id },
    });
    expect(remaining).toEqual([]);
  });

  it('rejects a second row with the same tokenHash via the unique index', async () => {
    const user = await prisma.user.create({ data: userData() });
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: 'shared-hash',
        expiresAt: new Date('2026-08-24'),
      },
    });

    await expect(
      prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: 'shared-hash',
          expiresAt: new Date('2026-08-24'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
