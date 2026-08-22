import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { DAY_MS } from 'src/common/time';
import { PrismaService } from 'src/prisma/prisma.service';
import { hashSecureToken, SECURE_TOKEN_LENGTH } from 'src/common/secure-token';
import { createUser as createUserIn } from './session.test-helper';

describe('POST /auth/confirmation (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const post = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/confirmation',
      payload: { token },
    });

  /** Unconfirmed unless said otherwise — the opposite default from the
   * helper's, this being the endpoint that confirms. Returns the token. */
  const createUser = async (
    overrides: { confirmedAt?: Date | null; confirmExpiresAt?: Date } = {},
  ): Promise<string> => {
    const token = 'a'.repeat(SECURE_TOKEN_LENGTH);
    await createUserIn(prisma, {
      confirmTokenHash: hashSecureToken(token),
      confirmExpiresAt: overrides.confirmExpiresAt,
      confirmedAt: overrides.confirmedAt ?? null,
    });
    return token;
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

  it('activates the account: confirmedAt is set only after the POST', async () => {
    const token = await createUser();

    const res = await post(token);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'confirmed' });
    const user = await prisma.user.findFirstOrThrow();
    expect(user.confirmedAt).not.toBeNull();
  });

  it('is idempotent: a second call with the same token answers "confirmed" again, not an error', async () => {
    const token = await createUser();

    const first = await post(token);
    const second = await post(token);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(first.payload)).toEqual({ status: 'confirmed' });
    expect(JSON.parse(second.payload)).toEqual({ status: 'confirmed' });
  });

  it('stays "confirmed" past confirmExpiresAt once already activated', async () => {
    const token = await createUser();
    await post(token);

    await prisma.user.updateMany({
      data: { confirmExpiresAt: new Date(Date.now() - DAY_MS) },
    });
    const res = await post(token);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'confirmed' });
  });

  it('does not activate an expired, unconfirmed account and answers "invalid"', async () => {
    const token = await createUser({
      confirmExpiresAt: new Date(Date.now() - DAY_MS),
    });

    const res = await post(token);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'invalid' });
    const user = await prisma.user.findFirstOrThrow();
    expect(user.confirmedAt).toBeNull();
  });

  it('reports "invalid" for an unknown token, same as an expired one', async () => {
    const res = await post('b'.repeat(SECURE_TOKEN_LENGTH));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'invalid' });
  });

  it('rejects a token longer than the ones we issue before hashing it', async () => {
    const res = await post('x'.repeat(SECURE_TOKEN_LENGTH + 1));

    expect(res.statusCode).toBe(400);
  });
});
