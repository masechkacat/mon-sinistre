import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { DAY_MS, VeilleService } from './veille.service';
import { communeFixture, createVeille } from './veille.test-helper';

describe('VeilleService.deleteExpiredUnconfirmed (integration)', () => {
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
    await prisma.$executeRaw`TRUNCATE TABLE "Veille", "Commune", "VeilleFormEmail" CASCADE`;
  });

  it('deletes an expired, unconfirmed subscription and its communes', async () => {
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
    await createVeille(prisma, {
      confirmedAt: null,
      confirmExpiresAt: new Date(Date.now() - DAY_MS),
      communeCodes: ['30189'],
    });

    await veille.deleteExpiredUnconfirmed();

    expect(await prisma.veille.findFirst()).toBeNull();
    expect(await prisma.veilleCommune.findFirst()).toBeNull();
  });

  it('keeps a confirmed subscription past its confirmExpiresAt', async () => {
    await createVeille(prisma, {
      confirmedAt: new Date(),
      confirmExpiresAt: new Date(Date.now() - 30 * DAY_MS),
    });

    await veille.deleteExpiredUnconfirmed();

    expect(await prisma.veille.findFirst()).not.toBeNull();
  });

  it('makes the confirmation link answer "invalid" without revealing the cause', async () => {
    const { confirmToken } = await createVeille(prisma, {
      confirmedAt: null,
      confirmExpiresAt: new Date(Date.now() - DAY_MS),
    });

    await veille.deleteExpiredUnconfirmed();

    const res = await app.inject({
      method: 'GET',
      url: `/veille/confirmation?token=${encodeURIComponent(confirmToken)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'invalid' });
  });
});
