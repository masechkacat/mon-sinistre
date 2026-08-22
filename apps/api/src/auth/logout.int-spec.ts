import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import { createIntTestApp } from 'src/app.int-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME, SESSION_RATE_LIMIT } from './auth.controller';
import { REFRESH_ROTATION_GRACE_MS } from './auth.service';
import {
  createUser,
  login,
  logout as logoutWith,
  refresh as refreshWith,
  refreshCookieOf,
  refreshSetCookieOf,
} from './session.test-helper';

describe('POST /auth/logout (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let throttler: ThrottlerStorageService;

  const refresh = (cookie: string) => refreshWith(app, cookie);
  const logout = (cookie: string) => logoutWith(app, cookie);

  beforeAll(async () => {
    app = await createIntTestApp();
    prisma = app.get(PrismaService);
    throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    throttler.storage.clear();
    await prisma.$executeRaw`TRUNCATE TABLE "User" CASCADE`;
  });

  it('deletes the refresh token so a subsequent refresh with the same cookie is rejected', async () => {
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));

    const res = await logout(cookie);
    expect(res.statusCode).toBe(204);

    const replay = await refresh(cookie);
    expect(replay.statusCode).toBe(401);

    expect(await prisma.refreshToken.findMany()).toEqual([]);
  });

  it('answers 204 on a repeat logout with the same cookie', async () => {
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));

    const first = await logout(cookie);
    const second = await logout(cookie);

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
  });

  it('ends only the presented session, and its cookie replayed at /auth/refresh later does not end the others', async () => {
    const email = await createUser(prisma);
    // Two independent sessions (e.g. two browsers) for the same account.
    const cookieA = refreshCookieOf(await login(app, email));
    const cookieB = refreshCookieOf(await login(app, email));

    const res = await logout(cookieA);
    expect(res.statusCode).toBe(204);

    // A silent refresh that was in flight when the tab logged out lands now:
    // a logged-out token is unknown, not a replay of a rotated one, so it
    // does not trip refresh's theft detection.
    const stale = await refresh(cookieA);
    expect(stale.statusCode).toBe(401);

    const stillB = await refresh(cookieB);
    expect(stillB.statusCode).toBe(200);
  });

  it('ends a session whose token was rotated out, and that token then stays a dead end', async () => {
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));
    const rotated = refreshCookieOf(await refresh(cookie));
    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 2 * REFRESH_ROTATION_GRACE_MS) },
    });

    expect((await logout(cookie)).statusCode).toBe(204);

    // The rotated-out row is gone with the logout; replaying it is unknown,
    // and the live successor is untouched by that replay.
    expect((await refresh(cookie)).statusCode).toBe(401);
    expect((await refresh(rotated)).statusCode).toBe(200);
  });

  it('answers 204 without a refresh cookie at all', async () => {
    const res = await logout('');

    expect(res.statusCode).toBe(204);
  });

  it('answers 204 for a tampered refresh cookie', async () => {
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));
    const tampered = cookie.replace(/.$/, cookie.endsWith('a') ? 'b' : 'a');

    const res = await logout(tampered);

    expect(res.statusCode).toBe(204);
  });

  it('clears the refresh cookie on the response', async () => {
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));

    const res = await logout(cookie);

    const cleared = refreshSetCookieOf(res);
    expect(cleared).toMatch(`${REFRESH_COOKIE_NAME}=;`);
    expect(cleared).toMatch(/Max-Age=0/);
  });

  it('is rate-limited like refresh', async () => {
    for (let i = 0; i < SESSION_RATE_LIMIT.limit; i++) {
      expect((await logout('')).statusCode).toBe(204);
    }

    expect((await logout('')).statusCode).toBe(429);
  });
});
