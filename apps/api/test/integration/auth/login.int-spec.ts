import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'test/helpers/app';
import { captureLogs } from 'test/helpers/mail-log';
import { PrismaService } from 'src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from 'src/auth/auth.controller';
import {
  createUser as createUserIn,
  PASSWORD,
  refreshSetCookieOf,
} from 'test/helpers/session';

describe('POST /auth/login (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const logs = captureLogs();

  const post = (body: object) =>
    app.inject({ method: 'POST', url: '/auth/login', payload: body });

  const createUser = (overrides?: Parameters<typeof createUserIn>[1]) =>
    createUserIn(prisma, overrides);

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

  it('logs in with a confirmed account: access in the body, refresh as an httpOnly cookie', async () => {
    const email = await createUser();

    const res = await post({ email, password: PASSWORD });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { accessToken: string };
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(0);

    const cookie = refreshSetCookieOf(res);
    expect(cookie).toContain(`${REFRESH_COOKIE_NAME}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/auth/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    const stored = await prisma.refreshToken.findFirstOrThrow();
    expect(stored.revokedAt).toBeNull();
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('accepts a different spelling of the same address, same as registration', async () => {
    await createUser({ email: 'user@example.fr' });

    const res = await post({ email: ' User@Example.Fr ', password: PASSWORD });

    expect(res.statusCode).toBe(200);
  });

  it('answers a nonexistent address and a wrong password identically', async () => {
    const email = await createUser();

    const unknownAddress = await post({
      email: 'no-such-account@example.fr',
      password: PASSWORD,
    });
    const wrongPassword = await post({ email, password: 'wrong-password' });

    expect(unknownAddress.statusCode).toBe(401);
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAddress.statusCode).toBe(wrongPassword.statusCode);
    expect(JSON.parse(unknownAddress.payload)).toEqual(
      JSON.parse(wrongPassword.payload),
    );
  });

  it('rejects a correct password for an unconfirmed account', async () => {
    const email = await createUser({ confirmedAt: null });

    const res = await post({ email, password: PASSWORD });

    expect(res.statusCode).toBe(401);
    expect(await prisma.refreshToken.findMany()).toEqual([]);
  });

  it('ignores credentials passed in the query string, even correct ones', async () => {
    const email = await createUser();
    const query = new URLSearchParams({ email, password: PASSWORD });

    const res = await app.inject({
      method: 'POST',
      url: `/auth/login?${query.toString()}`,
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(await prisma.refreshToken.findMany()).toEqual([]);
  });

  it('answers a non-string email or password with the same 401, not a 500', async () => {
    const email = await createUser();

    const numericEmail = await post({ email: 123, password: PASSWORD });
    const booleanPassword = await post({ email, password: true });

    expect(numericEmail.statusCode).toBe(401);
    expect(booleanPassword.statusCode).toBe(401);
  });

  it('issues distinct refresh tokens to two logins in the same second', async () => {
    const email = await createUser();

    const [first, second] = await Promise.all([
      post({ email, password: PASSWORD }),
      post({ email, password: PASSWORD }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.headers['set-cookie']).not.toEqual(
      second.headers['set-cookie'],
    );
    expect(await prisma.refreshToken.count()).toBe(2);
  });

  it('does not create a refresh token on any rejected attempt', async () => {
    const email = await createUser();
    await post({ email, password: 'wrong-password' });

    expect(await prisma.refreshToken.findMany()).toEqual([]);
  });

  it('never logs the email address or the password', async () => {
    const email = await createUser();

    await post({ email, password: PASSWORD });
    await post({ email, password: 'wrong-password' });

    logs.expectNoTraceOf(email, PASSWORD, 'wrong-password');
  });
});
