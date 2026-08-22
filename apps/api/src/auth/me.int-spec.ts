import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { createConfirmedUser, login } from './session.test-helper';

describe('GET /auth/me (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const me = (accessToken?: string) =>
    app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
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

  it('returns the email of the account owning the access token', async () => {
    const email = await createConfirmedUser(prisma);
    const loginRes = await login(app, email);
    const { accessToken } = JSON.parse(loginRes.payload) as {
      accessToken: string;
    };

    const res = await me(accessToken);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ email });
  });

  it('answers 401 with no token', async () => {
    const res = await me();

    expect(res.statusCode).toBe(401);
  });
});
