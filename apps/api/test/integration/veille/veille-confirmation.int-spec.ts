import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { DAY_MS } from 'src/veille/veille.service';
import { createVeille } from 'src/veille/veille.test-helper';
import { VEILLE_TOKEN_LENGTH } from 'src/veille/veille-token';

describe('/veille/confirmation (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const get = (token: string, extraQuery = '') =>
    app.inject({
      method: 'GET',
      url: `/veille/confirmation?token=${encodeURIComponent(token)}${extraQuery}`,
    });

  const post = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/veille/confirmation',
      payload: { token },
    });

  const createPending = async (
    overrides: Parameters<typeof createVeille>[1] = {},
  ): Promise<string> => (await createVeille(prisma, overrides)).confirmToken;

  beforeAll(async () => {
    app = await createIntTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Veille", "VeilleFormEmail" CASCADE`;
  });

  describe('GET', () => {
    it('does not confirm the subscription: confirmedAt stays null after a GET on a live link', async () => {
      const token = await createPending();

      const res = await get(token);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'pending' });
      const veille = await prisma.veille.findFirstOrThrow();
      expect(veille.confirmedAt).toBeNull();
    });

    it('reports "active" for a confirmed subscription', async () => {
      const token = await createPending({ confirmedAt: new Date() });

      const res = await get(token);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'active' });
    });

    it('reports "invalid" for an unknown token', async () => {
      const res = await get('unknown-token');

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'invalid' });
    });

    it('reports "invalid" for an expired, unconfirmed subscription — same as an unknown token', async () => {
      const token = await createPending({
        confirmExpiresAt: new Date(Date.now() - DAY_MS),
      });

      const res = await get(token);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'invalid' });
    });

    it('ignores the tracking params a mail gateway may append to the link', async () => {
      const token = await createPending();

      const res = await get(token, '&utm_source=mail');

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'pending' });
    });
  });

  describe('POST', () => {
    it('activates the subscription: confirmedAt is set only after the POST', async () => {
      const token = await createPending();
      const before = await prisma.veille.findFirstOrThrow();
      expect(before.confirmedAt).toBeNull();

      const res = await post(token);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'active' });
      const after = await prisma.veille.findFirstOrThrow();
      expect(after.confirmedAt).not.toBeNull();
    });

    it('a second POST and a later GET with the same token both answer "active", past confirmExpiresAt', async () => {
      const token = await createPending();

      const first = await post(token);
      const second = await post(token);

      expect(JSON.parse(first.payload)).toEqual({ status: 'active' });
      expect(JSON.parse(second.payload)).toEqual({ status: 'active' });

      await prisma.veille.updateMany({
        data: { confirmExpiresAt: new Date(Date.now() - DAY_MS) },
      });
      const res = await get(token);

      expect(JSON.parse(res.payload)).toEqual({ status: 'active' });
    });

    it('does not activate an expired, unconfirmed subscription', async () => {
      const token = await createPending({
        confirmExpiresAt: new Date(Date.now() - DAY_MS),
      });

      const res = await post(token);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'invalid' });
      const veille = await prisma.veille.findFirstOrThrow();
      expect(veille.confirmedAt).toBeNull();
    });

    it('reports "invalid" for an unknown token, same as an expired one', async () => {
      const res = await post('unknown-token');

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'invalid' });
    });

    it('rejects a token longer than the ones we issue before hashing it', async () => {
      const res = await post('x'.repeat(VEILLE_TOKEN_LENGTH + 1));

      expect(res.statusCode).toBe(400);
    });
  });
});
