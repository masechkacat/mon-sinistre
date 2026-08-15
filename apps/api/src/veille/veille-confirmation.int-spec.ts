import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { VEILLE_CONFIRM_TTL_DAYS } from '@mon-sinistre/contracts';
import { AppModule } from 'src/app.module';
import { createGlobalValidationPipe } from 'src/config/validation-pipe';
import { PrismaService } from 'src/prisma/prisma.service';
import { generateVeilleToken } from './veille-token';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('/veille/confirmation (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const get = (token: string) =>
    app.inject({
      method: 'GET',
      url: `/veille/confirmation?token=${encodeURIComponent(token)}`,
    });

  const post = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/veille/confirmation',
      payload: { token },
    });

  const createVeille = async (
    overrides: Partial<{
      confirmedAt: Date | null;
      confirmExpiresAt: Date;
    }> = {},
  ): Promise<string> => {
    const confirm = generateVeilleToken();
    const unsubscribe = generateVeilleToken();
    await prisma.veille.create({
      data: {
        email: `riverain-${Math.random()}@example.fr`,
        confirmTokenHash: confirm.hash,
        unsubscribeTokenHash: unsubscribe.hash,
        confirmedAt: overrides.confirmedAt ?? null,
        confirmExpiresAt:
          overrides.confirmExpiresAt ??
          new Date(Date.now() + VEILLE_CONFIRM_TTL_DAYS * DAY_MS),
      },
    });
    return confirm.token;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Veille" CASCADE`;
  });

  describe('GET', () => {
    it('does not confirm the subscription: confirmedAt stays null after a GET on a live link', async () => {
      const token = await createVeille();

      const res = await get(token);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'pending' });
      const veille = await prisma.veille.findFirstOrThrow();
      expect(veille.confirmedAt).toBeNull();
    });

    it('reports "active" for a confirmed subscription', async () => {
      const token = await createVeille({ confirmedAt: new Date() });

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
      const token = await createVeille({
        confirmExpiresAt: new Date(Date.now() - DAY_MS),
      });

      const res = await get(token);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'invalid' });
    });
  });

  describe('POST', () => {
    it('activates the subscription: confirmedAt is set only after the POST', async () => {
      const token = await createVeille();
      const before = await prisma.veille.findFirstOrThrow();
      expect(before.confirmedAt).toBeNull();

      const res = await post(token);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'active' });
      const after = await prisma.veille.findFirstOrThrow();
      expect(after.confirmedAt).not.toBeNull();
    });

    it('a second POST and a later GET with the same token both answer "active", past confirmExpiresAt', async () => {
      const token = await createVeille();

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
      const token = await createVeille({
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
  });
});
