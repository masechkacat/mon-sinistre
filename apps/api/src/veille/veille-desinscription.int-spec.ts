import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { VEILLE_CONFIRM_TTL_DAYS } from '@mon-sinistre/contracts';
import { AppModule } from 'src/app.module';
import { createGlobalValidationPipe } from 'src/config/validation-pipe';
import { PrismaService } from 'src/prisma/prisma.service';
import { DAY_MS, communeFixture } from './veille-commune.test-helper';
import { generateVeilleToken } from './veille-token';

describe('POST /veille/desinscription (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const post = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/veille/desinscription',
      payload: { token },
    });

  const createVeille = async (
    overrides: Partial<{ confirmedAt: Date | null }> = {},
  ): Promise<string> => {
    const confirm = generateVeilleToken();
    const unsubscribe = generateVeilleToken();
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
    await prisma.veille.create({
      data: {
        email: `riverain-${Math.random()}@example.fr`,
        confirmTokenHash: confirm.hash,
        unsubscribeTokenHash: unsubscribe.hash,
        confirmedAt: overrides.confirmedAt ?? null,
        confirmExpiresAt: new Date(
          Date.now() + VEILLE_CONFIRM_TTL_DAYS * DAY_MS,
        ),
        communes: { create: [{ codeInsee: '30189' }] },
      },
    });
    return unsubscribe.token;
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
    await prisma.$executeRaw`TRUNCATE TABLE "Veille", "Commune" CASCADE`;
  });

  it('deletes the subscription and its VeilleCommune rows', async () => {
    const token = await createVeille();

    const res = await post(token);

    expect(res.statusCode).toBe(204);
    expect(res.payload).toBe('');
    expect(await prisma.veille.findFirst()).toBeNull();
    expect(await prisma.veilleCommune.findFirst()).toBeNull();
  });

  it('answers 204 without error on a repeat call with the same token', async () => {
    const token = await createVeille();
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
    const token = await createVeille({ confirmedAt: null });

    const res = await post(token);

    expect(res.statusCode).toBe(204);
    expect(await prisma.veille.findFirst()).toBeNull();
  });

  it('still works after confirmation — the unsubscribe link carries no expiry', async () => {
    const token = await createVeille({ confirmedAt: new Date() });

    const res = await post(token);

    expect(res.statusCode).toBe(204);
    expect(await prisma.veille.findFirst()).toBeNull();
  });
});
