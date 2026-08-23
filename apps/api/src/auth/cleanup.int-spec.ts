import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { DAY_MS, HOUR_MS } from 'src/common/time';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthService } from './auth.service';
import { createUser } from './session.test-helper';

describe('AuthService.cleanupExpired (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const logs = captureLogs();

  beforeAll(async () => {
    app = await createIntTestApp();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "RefreshToken", "PasswordReset", "AccountFormEmail", "LoginAttempt" CASCADE`;
  });

  describe('deleteExpiredUnconfirmedUsers', () => {
    it('deletes an unconfirmed User past its confirmExpiresAt, cascading its RefreshToken', async () => {
      const email = await createUser(prisma, {
        confirmedAt: null,
        confirmExpiresAt: new Date(Date.now() - 8 * DAY_MS),
      });
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: `refresh-${Math.random()}`,
          expiresAt: new Date(Date.now() + 30 * DAY_MS),
        },
      });

      await auth.deleteExpiredUnconfirmedUsers();

      expect(await prisma.user.findFirst()).toBeNull();
      expect(await prisma.refreshToken.findFirst()).toBeNull();
    });

    it('keeps a confirmed User past its confirmExpiresAt', async () => {
      const email = await createUser(prisma, {
        confirmedAt: new Date(),
        confirmExpiresAt: new Date(Date.now() - 8 * DAY_MS),
      });

      await auth.deleteExpiredUnconfirmedUsers();

      expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull();
    });

    it('keeps an unconfirmed User whose deadline has not passed', async () => {
      const email = await createUser(prisma, { confirmedAt: null });

      await auth.deleteExpiredUnconfirmedUsers();

      expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull();
    });
  });

  describe('deleteExpiredPasswordResets', () => {
    it('deletes an expired PasswordReset row', async () => {
      const email = await createUser(prisma);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: `reset-${Math.random()}`,
          expiresAt: new Date(Date.now() - HOUR_MS),
        },
      });

      await auth.deleteExpiredPasswordResets();

      expect(await prisma.passwordReset.findFirst()).toBeNull();
    });

    it('keeps a PasswordReset row that has not expired', async () => {
      const email = await createUser(prisma);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: `reset-${Math.random()}`,
          expiresAt: new Date(Date.now() + HOUR_MS),
        },
      });

      await auth.deleteExpiredPasswordResets();

      expect(await prisma.passwordReset.findFirst()).not.toBeNull();
    });
  });

  describe('deleteExpiredRefreshTokens', () => {
    it('deletes an expired RefreshToken row', async () => {
      const email = await createUser(prisma);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: `refresh-${Math.random()}`,
          expiresAt: new Date(Date.now() - HOUR_MS),
        },
      });

      await auth.deleteExpiredRefreshTokens();

      expect(await prisma.refreshToken.findFirst()).toBeNull();
    });

    it('keeps a RefreshToken row that has not expired', async () => {
      const email = await createUser(prisma);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: `refresh-${Math.random()}`,
          expiresAt: new Date(Date.now() + 30 * DAY_MS),
        },
      });

      await auth.deleteExpiredRefreshTokens();

      expect(await prisma.refreshToken.findFirst()).not.toBeNull();
    });
  });

  describe('deleteStaleAccountFormEmailCounters', () => {
    it('removes counter rows older than the 24-hour window', async () => {
      await prisma.accountFormEmail.create({
        data: {
          emailHash: 'hash-stale',
          sentAt: new Date(Date.now() - DAY_MS - 1000),
        },
      });

      await auth.deleteStaleAccountFormEmailCounters();

      expect(await prisma.accountFormEmail.findFirst()).toBeNull();
    });

    it('keeps counter rows inside the window', async () => {
      await prisma.accountFormEmail.create({
        data: { emailHash: 'hash-fresh', sentAt: new Date(Date.now() - 1000) },
      });

      await auth.deleteStaleAccountFormEmailCounters();

      expect(await prisma.accountFormEmail.findFirst()).not.toBeNull();
    });
  });

  describe('deleteStaleLoginAttemptCounters', () => {
    it('removes counter rows older than the 1-hour window', async () => {
      await prisma.loginAttempt.create({
        data: {
          emailHash: 'hash-stale',
          attemptedAt: new Date(Date.now() - HOUR_MS - 1000),
        },
      });

      await auth.deleteStaleLoginAttemptCounters();

      expect(await prisma.loginAttempt.findFirst()).toBeNull();
    });

    it('keeps counter rows inside the window', async () => {
      await prisma.loginAttempt.create({
        data: {
          emailHash: 'hash-fresh',
          attemptedAt: new Date(Date.now() - 1000),
        },
      });

      await auth.deleteStaleLoginAttemptCounters();

      expect(await prisma.loginAttempt.findFirst()).not.toBeNull();
    });
  });

  it('runs the other cleanups even when one fails, and logs no message of the failure', async () => {
    await prisma.accountFormEmail.create({
      data: {
        emailHash: 'hash-stale',
        sentAt: new Date(Date.now() - DAY_MS - 1000),
      },
    });
    // A Prisma message is where an address would reach the log — the tick
    // catches the failure itself, precisely so nothing prints it verbatim.
    jest
      .spyOn(auth, 'deleteExpiredUnconfirmedUsers')
      .mockRejectedValueOnce(
        new Error('Unique constraint failed: victime@example.fr'),
      );

    await expect(auth.cleanupExpired()).resolves.toBeUndefined();

    expect(await prisma.accountFormEmail.findFirst()).toBeNull();
    expect(logs.levels()).toContain('error');
    logs.expectNoTraceOf('victime@example.fr');
  });
});
