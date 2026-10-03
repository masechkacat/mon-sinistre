import { PrismaClient } from 'src/generated/prisma/client';
import { E2E_COMMUNES, seedE2eReferential } from 'test/helpers/e2e-referential';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client';

// Сев базы сквозного теста (issue #174): идемпотентен и не ходит в сеть.
// Правила дедлайнов и шаги сев заливает теми же функциями, что покрыты своими спеками.
describe('seedE2eReferential (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Commune" CASCADE`;
  });

  it('seeds the fixture communes, repeatably', async () => {
    await seedE2eReferential(prisma);
    await seedE2eReferential(prisma);

    expect(await prisma.commune.count()).toBe(E2E_COMMUNES.length);
  });

  it('makes no network request', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await seedE2eReferential(prisma);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
