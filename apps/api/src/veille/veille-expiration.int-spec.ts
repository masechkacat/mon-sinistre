import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { DAY_MS, VeilleService } from './veille.service';
import {
  communeFixture,
  createFormEmail,
  createVeille,
} from './veille.test-helper';

describe('VeilleService.cleanupExpired (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let veille: VeilleService;
  const logs = captureLogs();

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

  describe('deleteExpiredUnconfirmed', () => {
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

    it('keeps an unconfirmed subscription whose deadline has not passed', async () => {
      await createVeille(prisma, { confirmedAt: null });

      await veille.deleteExpiredUnconfirmed();

      expect(await prisma.veille.findFirst()).not.toBeNull();
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

  describe('deleteStaleFormEmailCounters', () => {
    it('removes counter rows older than the 24-hour window', async () => {
      await createFormEmail(prisma, DAY_MS + 1000);

      await veille.deleteStaleFormEmailCounters();

      expect(await prisma.veilleFormEmail.findFirst()).toBeNull();
    });

    it('keeps counter rows inside the window, still counted toward the limit', async () => {
      await createFormEmail(prisma, 1000);

      await veille.deleteStaleFormEmailCounters();

      expect(await prisma.veilleFormEmail.findFirst()).not.toBeNull();
    });
  });

  it('runs the counter cleanup even when the subscription cleanup fails, and logs no message of the failure', async () => {
    await createFormEmail(prisma, DAY_MS + 1000);
    // A Prisma message is where an address would reach the log — the tick
    // catches the failure itself, precisely so nothing prints it verbatim.
    jest
      .spyOn(veille, 'deleteExpiredUnconfirmed')
      .mockRejectedValueOnce(
        new Error('Unique constraint failed: riverain@example.fr'),
      );

    await expect(veille.cleanupExpired()).resolves.toBeUndefined();

    expect(await prisma.veilleFormEmail.findFirst()).toBeNull();
    expect(logs.levels()).toContain('error');
    logs.expectNoTraceOf('riverain@example.fr');
  });
});
