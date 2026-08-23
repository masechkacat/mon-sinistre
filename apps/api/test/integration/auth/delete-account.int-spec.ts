import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { MAIL_TRANSPORT } from 'src/mail/mail-transport';
import { RecordingTransport } from 'src/mail/mail-transport.test-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from 'src/auth/auth.controller';
import {
  accessTokenOf,
  createUser,
  login,
  refresh as refreshWith,
  refreshCookieOf,
  refreshSetCookieOf,
  withBearer,
} from 'src/auth/session.test-helper';

describe('DELETE /auth/me (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let transport: RecordingTransport;

  const deleteAccount = (accessToken?: string) =>
    app.inject({
      method: 'DELETE',
      url: '/auth/me',
      headers: withBearer(accessToken),
    });

  const refresh = (cookie: string) => refreshWith(app, cookie);

  beforeAll(async () => {
    transport = new RecordingTransport();
    app = await createIntTestApp({
      customize: (builder) =>
        builder.overrideProvider(MAIL_TRANSPORT).useValue(transport),
    });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    transport.sent.length = 0;
    await prisma.$executeRaw`TRUNCATE TABLE "User", "AccountFormEmail" CASCADE`;
  });

  /** A logged-in account, then its deletion — the starting point every test
   * below asserts a consequence of. */
  const loginAndDelete = async () => {
    const email = await createUser(prisma);
    const loginRes = await login(app, email);
    const accessToken = accessTokenOf(loginRes);
    const cookie = refreshCookieOf(loginRes);

    const res = await deleteAccount(accessToken);

    return { email, cookie, res };
  };

  it('answers 401 without a valid access token', async () => {
    const res = await deleteAccount();

    expect(res.statusCode).toBe(401);
  });

  it('removes the account row from the database', async () => {
    const { res } = await loginAndDelete();

    expect(res.statusCode).toBe(204);
    expect(await prisma.user.findMany()).toEqual([]);
  });

  it('cascades onto the refresh token: it is gone with the account, not just revoked', async () => {
    await loginAndDelete();

    expect(await prisma.refreshToken.findMany()).toEqual([]);
  });

  it('makes the account impossible to log into afterwards', async () => {
    const { email } = await loginAndDelete();

    const attempt = await login(app, email);

    expect(attempt.statusCode).toBe(401);
  });

  it('rejects a refresh with the cookie issued before deletion', async () => {
    const { cookie } = await loginAndDelete();

    const res = await refresh(cookie);

    expect(res.statusCode).toBe(401);
  });

  it('clears the refresh cookie on the response', async () => {
    const { res } = await loginAndDelete();

    const cleared = refreshSetCookieOf(res);
    expect(cleared).toMatch(`${REFRESH_COOKIE_NAME}=;`);
    expect(cleared).toMatch(/Max-Age=0/);
  });

  it('lets the same address register a new, empty account afterwards', async () => {
    const { email } = await loginAndDelete();

    const registerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'Def!67890' },
    });

    expect(registerRes.statusCode).toBe(204);
    const user = await prisma.user.findFirstOrThrow();
    expect(user.email).toBe(email);
    expect(user.confirmedAt).toBeNull();
    expect(transport.sent).toHaveLength(1);
  });
});
