import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from './auth.controller';
import {
  createConfirmedUser,
  login,
  refreshCookieOf,
} from './session.test-helper';

describe('POST /auth/logout (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const refresh = (cookie: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: cookie ? { cookie } : {},
    });

  const logout = (cookie: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/logout',
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

  it('revokes the refresh token so a subsequent refresh with the same cookie is rejected', async () => {
    const email = await createConfirmedUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));

    const res = await logout(cookie);
    expect(res.statusCode).toBe(204);

    const replay = await refresh(cookie);
    expect(replay.statusCode).toBe(401);

    const row = await prisma.refreshToken.findFirstOrThrow();
    expect(row.revokedAt).not.toBeNull();
  });

  it('answers 204 on a repeat logout with the same cookie', async () => {
    const email = await createConfirmedUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));

    const first = await logout(cookie);
    const second = await logout(cookie);

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
  });

  it('revokes only the presented token, leaving other sessions of the same account logged in', async () => {
    const email = await createConfirmedUser(prisma);
    // Two independent sessions (e.g. two browsers) for the same account.
    const cookieA = refreshCookieOf(await login(app, email));
    const cookieB = refreshCookieOf(await login(app, email));

    const res = await logout(cookieA);
    expect(res.statusCode).toBe(204);

    // Checked before touching cookieA again: presenting an already-revoked
    // token to /auth/refresh trips its own reuse-detection (src/auth/CLAUDE.md)
    // and would chain-revoke session B too — a property of /auth/refresh, not
    // of logout, and covered by refresh.int-spec.ts already.
    const stillB = await refresh(cookieB);
    expect(stillB.statusCode).toBe(200);
  });

  it('answers 204 without a refresh cookie at all', async () => {
    const res = await logout('');

    expect(res.statusCode).toBe(204);
  });

  it('answers 204 for a tampered refresh cookie', async () => {
    const email = await createConfirmedUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));
    const tampered = cookie.replace(/.$/, cookie.endsWith('a') ? 'b' : 'a');

    const res = await logout(tampered);

    expect(res.statusCode).toBe(204);
  });

  it('clears the refresh cookie on the response', async () => {
    const email = await createConfirmedUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));

    const res = await logout(cookie);

    const setCookie = res.headers['set-cookie'];
    const cleared = (Array.isArray(setCookie) ? setCookie : [setCookie]).find(
      (value): value is string =>
        typeof value === 'string' &&
        value.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(cleared).toMatch(`${REFRESH_COOKIE_NAME}=;`);
    expect(cleared).toMatch(/Max-Age=0/);
  });
});
