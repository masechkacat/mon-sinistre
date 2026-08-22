import { Controller, Get } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { createConfirmedUser, login } from './session.test-helper';
import { Public } from './public.decorator';

/**
 * A route per case the global guard has to tell apart. Added to the testing
 * module, not to AppModule: the guard under test is registered globally in
 * AppModule (via APP_GUARD), so a controller declared beside it is covered
 * by the very registration this spec exists to prove.
 */
@Controller('guard-test')
class GuardTestController {
  @Get('protected')
  protectedRoute(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Get('public')
  publicRoute(): { ok: true } {
    return { ok: true };
  }
}

describe('JwtAuthGuard (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createIntTestApp({
      metadata: { controllers: [GuardTestController] },
    });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User" CASCADE`;
  });

  it('answers 401 on an endpoint without @Public() when no token is sent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/guard-test/protected',
    });

    expect(res.statusCode).toBe(401);
  });

  it('answers 401 on an endpoint without @Public() when the token is garbage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/guard-test/protected',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('lets a valid access token through on an endpoint without @Public()', async () => {
    const email = await createConfirmedUser(prisma);
    const loginRes = await login(app, email);
    const { accessToken } = JSON.parse(loginRes.payload) as {
      accessToken: string;
    };

    const res = await app.inject({
      method: 'GET',
      url: '/guard-test/protected',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('answers 200 with no token on an endpoint marked @Public()', async () => {
    const res = await app.inject({ method: 'GET', url: '/guard-test/public' });

    expect(res.statusCode).toBe(200);
  });

  it('leaves the existing public endpoints reachable with no token', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    const communes = await app.inject({
      method: 'GET',
      url: '/communes?q=ab',
    });
    const register = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'nouveau@example.fr', password: 'Abc12345' },
    });

    expect(health.statusCode).toBe(200);
    expect(communes.statusCode).toBe(200);
    expect(register.statusCode).toBe(204);
  });
});
