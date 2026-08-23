import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import { LOGIN_ATTEMPT_LIMIT } from '@mon-sinistre/contracts';
import { createIntTestApp } from 'src/app.int-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { createUser as createUserIn, PASSWORD } from './session.test-helper';

describe('login attempt rate limit (LOGIN_ATTEMPT_LIMIT)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let throttler: ThrottlerStorageService;

  const login = (email: string, password: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

  const createUser = (overrides?: Parameters<typeof createUserIn>[1]) =>
    createUserIn(prisma, overrides);

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
    await prisma.$executeRaw`TRUNCATE TABLE "User", "LoginAttempt" CASCADE`;
  });

  it('answers 429 for an unknown address after LOGIN_ATTEMPT_LIMIT failures within the hour', async () => {
    const email = 'inconnu@example.fr';

    for (let i = 0; i < LOGIN_ATTEMPT_LIMIT; i++) {
      const res = await login(email, 'wrong-password');
      expect(res.statusCode).toBe(401);
    }

    const eleventh = await login(email, 'wrong-password');

    expect(eleventh.statusCode).toBe(429);
  });

  it('answers 429 identically for a known and an unknown address once each is over the limit', async () => {
    const known = await createUser();
    const unknown = 'inconnu-2@example.fr';

    for (let i = 0; i < LOGIN_ATTEMPT_LIMIT; i++) {
      expect((await login(known, 'wrong-password')).statusCode).toBe(401);
      expect((await login(unknown, 'wrong-password')).statusCode).toBe(401);
    }

    const knownBlocked = await login(known, 'wrong-password');
    const unknownBlocked = await login(unknown, 'wrong-password');

    expect(knownBlocked.statusCode).toBe(429);
    expect(unknownBlocked.statusCode).toBe(429);
    expect(JSON.parse(knownBlocked.payload)).toEqual(
      JSON.parse(unknownBlocked.payload),
    );
  });

  it('lets a correct login through while the address is still under the threshold', async () => {
    const email = await createUser();

    for (let i = 0; i < LOGIN_ATTEMPT_LIMIT - 1; i++) {
      await login(email, 'wrong-password');
    }

    const res = await login(email, PASSWORD);

    expect(res.statusCode).toBe(200);
  });

  it('keeps counting failures for one address without affecting another', async () => {
    const blocked = 'victime-bloquee@example.fr';
    const untouched = await createUser({ email: 'victime-normale@example.fr' });

    for (let i = 0; i < LOGIN_ATTEMPT_LIMIT; i++) {
      await login(blocked, 'wrong-password');
    }
    expect((await login(blocked, 'wrong-password')).statusCode).toBe(429);

    const res = await login(untouched, PASSWORD);
    expect(res.statusCode).toBe(200);
  });
});
