import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'test/helpers/app';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  accessTokenOf,
  createUser,
  login,
  withBearer,
} from 'test/helpers/session';

describe('GET /auth/me (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const me = (accessToken?: string) =>
    app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: withBearer(accessToken),
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

  it('returns the email of the account owning the access token, reminders on', async () => {
    const email = await createUser(prisma);
    const accessToken = accessTokenOf(await login(app, email));

    const res = await me(accessToken);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ email, remindersEnabled: true });
  });

  it('answers remindersEnabled false once the account turned reminders off', async () => {
    const email = await createUser(prisma);
    await prisma.user.update({
      where: { email },
      data: { remindersDisabledAt: new Date() },
    });
    const accessToken = accessTokenOf(await login(app, email));

    const res = await me(accessToken);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ email, remindersEnabled: false });
  });

  it('answers 401, not 404, once the account behind a still-valid token is gone', async () => {
    const email = await createUser(prisma);
    const accessToken = accessTokenOf(await login(app, email));
    await prisma.user.deleteMany();

    const res = await me(accessToken);

    expect(res.statusCode).toBe(401);
  });

  it('answers 401 with no token', async () => {
    const res = await me();

    expect(res.statusCode).toBe(401);
  });
});
