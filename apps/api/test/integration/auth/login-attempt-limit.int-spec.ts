import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import { LOGIN_ATTEMPT_LIMIT } from '@mon-sinistre/contracts';
import { createIntTestApp } from 'test/helpers/app';
import { hashSecureToken } from 'src/common/security/secure-token';
import { HOUR_MS } from 'src/common/time/time';
import { PrismaService } from 'src/prisma/prisma.service';
import { createUser as createUserIn, PASSWORD } from 'test/helpers/session';

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
    await prisma.$executeRaw`TRUNCATE TABLE "User", "LoginAttempt", "PasswordReset" CASCADE`;
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

  it('lets the right password through past the limit, and clears the address counter', async () => {
    const email = await createUser();

    for (let i = 0; i < LOGIN_ATTEMPT_LIMIT; i++) {
      await login(email, 'wrong-password');
    }
    expect((await login(email, 'wrong-password')).statusCode).toBe(429);

    const res = await login(email, PASSWORD);

    // Otherwise ten wrong guesses an hour — cheap, and spreadable across IPs
    // — lock the owner out of their own account indefinitely.
    expect(res.statusCode).toBe(200);
    expect(await prisma.loginAttempt.count()).toBe(0);
  });

  it('clears the counter on a completed password reset', async () => {
    const email = await createUser();
    await prisma.passwordReset.create({
      data: {
        user: { connect: { email } },
        tokenHash: hashSecureToken('reset-token'),
        expiresAt: new Date(Date.now() + HOUR_MS),
      },
    });
    for (let i = 0; i < LOGIN_ATTEMPT_LIMIT; i++) {
      await login(email, 'wrong-password');
    }
    expect(await prisma.loginAttempt.count()).toBe(LOGIN_ATTEMPT_LIMIT);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: 'reset-token', password: 'Def!67890' },
    });

    expect(JSON.parse(res.payload)).toEqual({ status: 'reset' });
    expect(await prisma.loginAttempt.count()).toBe(0);
  });

  it('does not overshoot the limit when the failures arrive at once', async () => {
    const email = 'inconnu-3@example.fr';
    const burst = LOGIN_ATTEMPT_LIMIT * 2;

    const answers = await Promise.all(
      Array.from({ length: burst }, () => login(email, 'wrong-password')),
    );

    // The invariant, not a reproduction of the race it guards against:
    // whatever the interleaving, the counter never passes the limit
    // (`withAddressLock`, `src/common/address-lock.ts`).
    expect(await prisma.loginAttempt.count()).toBe(LOGIN_ATTEMPT_LIMIT);
    expect(answers.filter((res) => res.statusCode === 429)).toHaveLength(
      burst - LOGIN_ATTEMPT_LIMIT,
    );
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
