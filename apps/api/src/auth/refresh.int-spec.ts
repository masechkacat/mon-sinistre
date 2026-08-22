import * as bcrypt from 'bcrypt';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { DAY_MS } from 'src/common/time';
import { PrismaService } from 'src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from './auth.controller';

/** Cheap on purpose — this is a test fixture's cost, not a real account's. */
const TEST_SALT_ROUNDS = 4;
const PASSWORD = 'Abc12345';

describe('POST /auth/refresh (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const login = (email: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: PASSWORD },
    });

  const refresh = (cookie: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: cookie ? { cookie } : {},
    });

  /** The `name=value` segment of a `Set-Cookie` response header, ready to be
   * replayed as the `Cookie` request header — the signature suffix
   * `@fastify/cookie` appended stays untouched either way. */
  const refreshCookieOf = (res: {
    headers: Record<string, unknown>;
  }): string => {
    const setCookie = res.headers['set-cookie'];
    const raw = (Array.isArray(setCookie) ? setCookie : [setCookie]).find(
      (value): value is string =>
        typeof value === 'string' &&
        value.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    if (!raw) throw new Error('no refresh cookie in response');
    return raw.split(';')[0] ?? raw;
  };

  const createUser = async (): Promise<string> => {
    const email = `victime-${Math.random()}@example.fr`;
    await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(PASSWORD, TEST_SALT_ROUNDS),
        confirmTokenHash: `token-${Math.random()}`,
        confirmExpiresAt: new Date(Date.now() + DAY_MS),
        confirmedAt: new Date(),
      },
    });
    return email;
  };

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
    const email = await createUser();
    const loginRes = await login(email);
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
    const email = await createUser();
    const cookie = refreshCookieOf(await login(email));

    const res = await refresh(cookie);

    expect(res.statusCode).toBe(200);
  });

  it('rejects the old token once it has been rotated out', async () => {
    const email = await createUser();
    const cookie = refreshCookieOf(await login(email));
    await refresh(cookie);

    const replay = await refresh(cookie);

    expect(replay.statusCode).toBe(401);
  });

  it('reuse of an already-rotated token revokes every other live token of that user', async () => {
    const email = await createUser();
    // Two independent sessions (e.g. two browsers) for the same account.
    const cookieA = refreshCookieOf(await login(email));
    const cookieB = refreshCookieOf(await login(email));

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
    const email = await createUser();
    const cookie = refreshCookieOf(await login(email));
    const tampered = cookie.replace(/.$/, cookie.endsWith('a') ? 'b' : 'a');

    const res = await refresh(tampered);

    expect(res.statusCode).toBe(401);
  });
});
