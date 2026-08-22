import * as bcrypt from 'bcrypt';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from './auth.controller';

/** Cheap on purpose — this is a test fixture's cost, not a real account's. */
const TEST_SALT_ROUNDS = 4;
const PASSWORD = 'Abc12345';

describe('POST /auth/login (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const logs = captureLogs();

  const post = (body: object) =>
    app.inject({ method: 'POST', url: '/auth/login', payload: body });

  const createUser = async (
    overrides: { email?: string; confirmedAt?: Date | null } = {},
  ): Promise<string> => {
    const email = overrides.email ?? `victime-${Math.random()}@example.fr`;
    await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(PASSWORD, TEST_SALT_ROUNDS),
        confirmTokenHash: `token-${Math.random()}`,
        confirmExpiresAt: new Date(Date.now() + 86_400_000),
        confirmedAt:
          overrides.confirmedAt === undefined
            ? new Date()
            : overrides.confirmedAt,
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

  it('logs in with a confirmed account: access in the body, refresh as an httpOnly cookie', async () => {
    const email = await createUser();

    const res = await post({ email, password: PASSWORD });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { accessToken: string };
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(0);

    const setCookie = res.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie.join(';') : setCookie;
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
