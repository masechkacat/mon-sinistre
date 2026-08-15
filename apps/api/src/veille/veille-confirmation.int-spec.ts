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

describe('GET /veille/confirmation (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const get = (token: string) =>
    app.inject({
      method: 'GET',
      url: `/veille/confirmation?token=${encodeURIComponent(token)}`,
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
