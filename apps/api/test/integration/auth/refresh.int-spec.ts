import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import { createIntTestApp } from 'test/helpers/app';
import type { EnvironmentVariables } from 'src/config/env.validation';
import type { Prisma } from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME, SESSION_RATE_LIMIT } from 'src/auth/auth.controller';
import {
  REFRESH_ROTATION_GRACE_MS,
  TOKEN_TYPE,
  type TokenPayload,
} from 'src/auth/auth.service';
import {
  accessTokenOf,
  createUser,
  login,
  refresh as refreshWith,
  refreshCookieOf,
} from 'test/helpers/session';

describe('POST /auth/refresh (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let throttler: ThrottlerStorageService;

  const refresh = (cookie: string) => refreshWith(app, cookie);

  /** Moves every rotation so far out of the grace window, as if it had
   * happened long ago — the clock itself stays real. */
  const ageRotations = () =>
    prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 2 * REFRESH_ROTATION_GRACE_MS) },
    });

  beforeAll(async () => {
    app = await createIntTestApp();
    prisma = app.get(PrismaService);
    throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Every test shares one client address, so without this the rate limit of
    // the route would count the whole file as a single caller.
    throttler.storage.clear();
    await prisma.$executeRaw`TRUNCATE TABLE "User" CASCADE`;
  });

  it('rotates: revokes the presented token, issues a fresh access token and a new cookie', async () => {
    const email = await createUser(prisma);
    const loginRes = await login(app, email);
    const oldCookie = refreshCookieOf(loginRes);
    const oldTokenHash = (await prisma.refreshToken.findFirstOrThrow())
      .tokenHash;

    const res = await refresh(oldCookie);

    expect(res.statusCode).toBe(200);
    expect(accessTokenOf(res).length).toBeGreaterThan(0);

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
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));

    const res = await refresh(cookie);

    expect(res.statusCode).toBe(200);
  });

  it('honours a second presentation within the grace window: two tabs both get their own fresh pair', async () => {
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));

    const [tabA, tabB] = await Promise.all([refresh(cookie), refresh(cookie)]);

    expect(tabA.statusCode).toBe(200);
    expect(tabB.statusCode).toBe(200);
    expect(refreshCookieOf(tabA)).not.toBe(refreshCookieOf(tabB));
    // Both new tokens are live, and both keep working.
    expect((await refresh(refreshCookieOf(tabA))).statusCode).toBe(200);
    expect((await refresh(refreshCookieOf(tabB))).statusCode).toBe(200);
  });

  it('rejects the old token once its rotation is older than the grace window', async () => {
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));
    await refresh(cookie);
    await ageRotations();

    const replay = await refresh(cookie);

    expect(replay.statusCode).toBe(401);
  });

  it('reuse of a long-rotated token ends every other live session of that user', async () => {
    const email = await createUser(prisma);
    // Two independent sessions (e.g. two browsers) for the same account.
    const cookieA = refreshCookieOf(await login(app, email));
    const cookieB = refreshCookieOf(await login(app, email));

    // Session A rotates once, legitimately — its old token is now revoked.
    const rotatedA = await refresh(cookieA);
    expect(rotatedA.statusCode).toBe(200);
    const rotatedCookieA = refreshCookieOf(rotatedA);
    await ageRotations();

    // The rotated-out token from session A resurfaces (stolen, replayed).
    const reuse = await refresh(cookieA);
    expect(reuse.statusCode).toBe(401);

    // The whole chain is dead: session A's fresh token and session B's
    // still-unrotated token are both gone now, not just the reused one.
    const afterA = await refresh(rotatedCookieA);
    const afterB = await refresh(cookieB);
    expect(afterA.statusCode).toBe(401);
    expect(afterB.statusCode).toBe(401);

    expect(
      await prisma.refreshToken.count({ where: { revokedAt: null } }),
    ).toBe(0);
  });

  /**
   * Runs the next rotation with `refreshToken.create` of its transaction
   * replaced — a spy on `prisma.refreshToken.create` would not see it, the
   * transaction client being a separate object. Restored by the caller.
   */
  const nextRotationCreates = (
    create: (
      tx: Prisma.TransactionClient,
      args: Prisma.RefreshTokenCreateArgs,
    ) => Promise<unknown>,
  ) =>
    jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(
        (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          prisma.$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get: (target, key) =>
                  key === 'refreshToken'
                    ? new Proxy(target.refreshToken, {
                        get: (model, method) =>
                          method === 'create'
                            ? (args: Prisma.RefreshTokenCreateArgs) =>
                                create(tx, args)
                            : (Reflect.get(model, method) as unknown),
                      })
                    : (Reflect.get(target, key) as unknown),
              }),
            ),
          ),
      );

  it('keeps the presented token valid when the replacement cannot be written', async () => {
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));
    const spy = nextRotationCreates(() =>
      Promise.reject(new Error('connection reset')),
    );

    try {
      expect((await refresh(cookie)).statusCode).toBe(500);
    } finally {
      spy.mockRestore();
    }

    // The transaction rolled the revoke back: no replacement, no reuse
    // branch, the next attempt simply works.
    const row = await prisma.refreshToken.findFirstOrThrow();
    expect(row.revokedAt).toBeNull();
    expect((await refresh(cookie)).statusCode).toBe(200);
  });

  it('answers 401, not 500, when the account disappears mid-rotation', async () => {
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));
    const spy = nextRotationCreates(async (tx, args) => {
      await tx.user.deleteMany();
      return tx.refreshToken.create(args);
    });

    try {
      expect((await refresh(cookie)).statusCode).toBe(401);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a token signed with the refresh secret whose typ is not refresh', async () => {
    const email = await createUser(prisma);
    const { id } = await prisma.user.findFirstOrThrow({ where: { email } });
    const config = app.get(ConfigService<EnvironmentVariables, true>);
    const forged = await app
      .get(JwtService)
      .signAsync({ sub: id, typ: TOKEN_TYPE.access } satisfies TokenPayload, {
        secret: config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: '1m',
      });
    const signed = app.getHttpAdapter().getInstance().signCookie(forged);

    const res = await refresh(
      `${REFRESH_COOKIE_NAME}=${encodeURIComponent(signed)}`,
    );

    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing refresh cookie', async () => {
    const res = await refresh('');

    expect(res.statusCode).toBe(401);
  });

  it('rejects a tampered refresh cookie', async () => {
    const email = await createUser(prisma);
    const cookie = refreshCookieOf(await login(app, email));
    const tampered = cookie.replace(/.$/, cookie.endsWith('a') ? 'b' : 'a');

    const res = await refresh(tampered);

    expect(res.statusCode).toBe(401);
  });

  it('rate-limits one caller replaying a cookie in a loop', async () => {
    for (let i = 0; i < SESSION_RATE_LIMIT.limit; i++) {
      expect((await refresh('')).statusCode).toBe(401);
    }

    expect((await refresh('')).statusCode).toBe(429);
  });
});
