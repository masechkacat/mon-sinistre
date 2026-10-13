import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from 'vitest';
import { PrismaClient } from 'src/generated/prisma/client.js';
import {
  E2E_COMMUNES,
  seedE2eReferential,
} from 'test/helpers/e2e-referential.js';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client.js';

// Здесь, а не в своём каталоге: собственная логика сева — только коммуны,
// правила дедлайнов и шаги он заливает функциями, покрытыми спеками их модулей.
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
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await seedE2eReferential(prisma);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
