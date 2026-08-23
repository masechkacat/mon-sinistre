import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'test/helpers/app';
import { HOUR_MS } from 'src/common/time';
import { hashSecureToken, SECURE_TOKEN_LENGTH } from 'src/common/secure-token';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  createUser as createUserIn,
  login,
  refresh,
  refreshCookieOf,
} from 'test/helpers/session';

describe('POST /auth/password-reset/confirm (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const post = (body: object) =>
    app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: body,
    });

  /** A user plus a live `PasswordReset` row for it. Returns the token and
   * the user's email. */
  const createUserWithReset = async (
    overrides: { expiresAt?: Date; confirmedAt?: Date | null } = {},
  ) => {
    const email = await createUserIn(
      prisma,
      'confirmedAt' in overrides ? { confirmedAt: overrides.confirmedAt } : {},
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = 'a'.repeat(SECURE_TOKEN_LENGTH);
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashSecureToken(token),
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + HOUR_MS),
      },
    });
    return { email, token, userId: user.id };
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

  it('sets the new password, marks the token used and answers "reset"', async () => {
    const { email, token } = await createUserWithReset();

    const res = await post({ token, password: 'NewPass12' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'reset' });
    const reset = await prisma.passwordReset.findFirstOrThrow();
    expect(reset.usedAt).not.toBeNull();

    const oldLogin = await login(app, email);
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'NewPass12' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('revokes every live refresh token of the account', async () => {
    const { email, token } = await createUserWithReset();
    const loginRes = await login(app, email);
    const cookie = refreshCookieOf(loginRes);

    await post({ token, password: 'NewPass12' });

    const refreshRes = await refresh(app, cookie);
    expect(refreshRes.statusCode).toBe(401);
  });

  it('rejects a reused token as "invalid" and does not touch the password again', async () => {
    const { email, token } = await createUserWithReset();
    await post({ token, password: 'NewPass12' });

    const second = await post({ token, password: 'AnotherOne1' });

    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.payload)).toEqual({ status: 'invalid' });
    const stillWorks = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'NewPass12' },
    });
    expect(stillWorks.statusCode).toBe(200);
  });

  it('spends every outstanding reset token of the account, not only the presented one', async () => {
    const { email, token, userId } = await createUserWithReset();
    const olderToken = 'c'.repeat(SECURE_TOKEN_LENGTH);
    await prisma.passwordReset.create({
      data: {
        userId,
        tokenHash: hashSecureToken(olderToken),
        expiresAt: new Date(Date.now() + HOUR_MS),
      },
    });

    await post({ token, password: 'NewPass12' });
    const replay = await post({ token: olderToken, password: 'AnotherOne1' });

    expect(replay.statusCode).toBe(200);
    expect(JSON.parse(replay.payload)).toEqual({ status: 'invalid' });
    const chosenPasswordHolds = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'NewPass12' },
    });
    expect(chosenPasswordHolds.statusCode).toBe(200);
  });

  it('confirms a not-yet-confirmed account, so the new password signs in at once', async () => {
    const { email, token } = await createUserWithReset({ confirmedAt: null });

    const res = await post({ token, password: 'NewPass12' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'reset' });
    const signIn = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'NewPass12' },
    });
    expect(signIn.statusCode).toBe(200);
  });

  it('reports "invalid" for an expired token, same as an unknown one', async () => {
    const { token } = await createUserWithReset({
      expiresAt: new Date(Date.now() - HOUR_MS),
    });

    const expired = await post({ token, password: 'NewPass12' });
    const unknown = await post({
      token: 'b'.repeat(SECURE_TOKEN_LENGTH),
      password: 'NewPass12',
    });

    expect(expired.statusCode).toBe(200);
    expect(JSON.parse(expired.payload)).toEqual({ status: 'invalid' });
    expect(expired.payload).toBe(unknown.payload);
  });

  it('rejects a password that fails the CNIL policy with 400, before touching the token', async () => {
    const { token } = await createUserWithReset();

    const res = await post({ token, password: 'short' });

    expect(res.statusCode).toBe(400);
    const reset = await prisma.passwordReset.findFirstOrThrow();
    expect(reset.usedAt).toBeNull();
  });
});
