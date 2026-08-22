import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  createConfirmedUser,
  login,
  refreshCookieOf,
} from './session.test-helper';

describe('POST /auth/refresh (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const refresh = (cookie: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: cookie ? { cookie } : {},
    });

  beforeAll(async () => {
    app = await createIntTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User" CASCADE`;
  });

  it('rotates: revokes the presented token, issues a fresh access token and a new cookie', async () => {
    const email = await createConfirmedUser(prisma);
    const loginRes = await login(app, email);
    const oldCookie = refreshCookieOf(loginRes);
    const oldTokenHash = (await prisma.refreshToken.findFirstOrThrow())
      .tokenHash;

    const res = await refresh(oldCookie);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { accessToken: string };
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(0);

    const newCookie = refreshCookieOf(res);
    expect(newCookie).not.toBe(oldCookie);

    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(2);
    const oldRow = rows.find((row) => row.tokenHash === oldTokenHash);
    const newRow = rows.find((row) => row.tokenHash !== oldTokenHash);
    expect(oldRow?.revokedAt).not.toBeNull();
    expect(newRow?.revokedAt).toBeNull();
    expect(newRow?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not require a password to obtain a new access token', async () => {
    const email = await createConfirmedUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));

    const res = await refresh(cookie);

    expect(res.statusCode).toBe(200);
  });

  it('rejects the old token once it has been rotated out', async () => {
    const email = await createConfirmedUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));
    await refresh(cookie);

    const replay = await refresh(cookie);

    expect(replay.statusCode).toBe(401);
  });

  it('reuse of an already-rotated token revokes every other live token of that user', async () => {
    const email = await createConfirmedUser(prisma);
    // Two independent sessions (e.g. two browsers) for the same account.
    const cookieA = refreshCookieOf(await login(app, email));
    const cookieB = refreshCookieOf(await login(app, email));

    // Session A rotates once, legitimately — its old token is now revoked.
    const rotatedA = await refresh(cookieA);
    expect(rotatedA.statusCode).toBe(200);
    const rotatedCookieA = refreshCookieOf(rotatedA);

    // The rotated-out token from session A resurfaces (stolen, replayed).
    const reuse = await refresh(cookieA);
    expect(reuse.statusCode).toBe(401);

    // The whole chain is dead: session A's fresh token and session B's
    // still-unrotated token are both revoked now, not just the reused one.
    const afterA = await refresh(rotatedCookieA);
    const afterB = await refresh(cookieB);
    expect(afterA.statusCode).toBe(401);
    expect(afterB.statusCode).toBe(401);

    const rows = await prisma.refreshToken.findMany();
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('rejects a missing refresh cookie', async () => {
    const res = await refresh('');

    expect(res.statusCode).toBe(401);
  });

  it('rejects a tampered refresh cookie', async () => {
    const email = await createConfirmedUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));
    const tampered = cookie.replace(/.$/, cookie.endsWith('a') ? 'b' : 'a');

    const res = await refresh(tampered);

    expect(res.statusCode).toBe(401);
  });
});
