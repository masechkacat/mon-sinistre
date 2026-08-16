import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { DAY_MS, VeilleService } from './veille.service';

describe('VeilleService.deleteStaleFormEmailCounters (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let veille: VeilleService;

  beforeAll(async () => {
    app = await createIntTestApp();
    prisma = app.get(PrismaService);
    veille = app.get(VeilleService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "VeilleFormEmail" CASCADE`;
  });

  it('removes counter rows older than the 24-hour window', async () => {
    await prisma.veilleFormEmail.create({
      data: {
        emailHash: 'hash-old',
        sentAt: new Date(Date.now() - DAY_MS - 1000),
      },
    });

    await veille.deleteStaleFormEmailCounters();

    expect(await prisma.veilleFormEmail.findFirst()).toBeNull();
  });

  it('keeps counter rows inside the window, still counted toward the limit', async () => {
    await prisma.veilleFormEmail.create({
      data: { emailHash: 'hash-fresh', sentAt: new Date(Date.now() - 1000) },
    });

    await veille.deleteStaleFormEmailCounters();

    const count = await prisma.veilleFormEmail.count({
      where: {
        emailHash: 'hash-fresh',
        sentAt: { gte: new Date(Date.now() - DAY_MS) },
      },
    });
    expect(count).toBe(1);
  });
});
