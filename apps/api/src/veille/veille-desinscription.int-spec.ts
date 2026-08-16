import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { communeFixture, createVeille } from './veille.test-helper';

describe('POST /veille/desinscription (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const post = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/veille/desinscription',
      payload: { token },
    });

  const createUnsubscribable = async (
    overrides: Parameters<typeof createVeille>[1] = {},
  ): Promise<string> =>
    (await createVeille(prisma, overrides)).unsubscribeToken;

  beforeAll(async () => {
    app = await createIntTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Veille", "Commune", "VeilleFormEmail" CASCADE`;
  });

  it('deletes the subscription and its VeilleCommune rows', async () => {
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
    const token = await createUnsubscribable({ communeCodes: ['30189'] });

    const res = await post(token);

    expect(res.statusCode).toBe(204);
    expect(res.payload).toBe('');
    expect(await prisma.veille.findFirst()).toBeNull();
    expect(await prisma.veilleCommune.findFirst()).toBeNull();
  });

  it('answers 204 without error on a repeat call with the same token', async () => {
    const token = await createUnsubscribable();
    await post(token);

    const res = await post(token);

    expect(res.statusCode).toBe(204);
    expect(res.payload).toBe('');
  });

  it('answers 204 without error on an unknown token', async () => {
    const res = await post('unknown-token');

    expect(res.statusCode).toBe(204);
    expect(res.payload).toBe('');
  });

  it('deletes an unconfirmed subscription entirely — the link sent in the phase 1 mail', async () => {
    const token = await createUnsubscribable({ confirmedAt: null });

    const res = await post(token);

    expect(res.statusCode).toBe(204);
    expect(await prisma.veille.findFirst()).toBeNull();
  });

  it('still works after confirmation — the unsubscribe link carries no expiry', async () => {
    const token = await createUnsubscribable({ confirmedAt: new Date() });

    const res = await post(token);

    expect(res.statusCode).toBe(204);
    expect(await prisma.veille.findFirst()).toBeNull();
  });
});
