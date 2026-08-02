import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { COMMUNE_SEARCH_LIMIT, Commune } from '@mon-sinistre/contracts';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';

const SOURCE = {
  sourceUrl: 'https://geo.api.gouv.fr/communes',
  sourceVerifiedAt: new Date('2026-08-02'),
};

const commune = (
  codeInsee: string,
  name: string,
  departementCode: string,
  departementName: string,
  effectiveTo: string | null = null,
) => ({
  codeInsee,
  name,
  departementCode,
  departementName,
  effectiveTo: effectiveTo === null ? null : new Date(effectiveTo),
  ...SOURCE,
});

describe('GET /communes (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const search = (q?: string) =>
    app.inject({
      method: 'GET',
      url: '/communes',
      query: q === undefined ? {} : { q },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // Same global pipe as main.ts — the validation behaviour under test.
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Commune" CASCADE`;
  });

  it('finds communes by name prefix and returns name and département', async () => {
    await prisma.commune.createMany({
      data: [
        commune('02168', 'Château-Thierry', '02', 'Aisne'),
        commune('75056', 'Paris', '75', 'Paris'),
      ],
    });

    const res = await search('Châ');

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as Commune[];
    expect(body).toEqual([
      {
        codeInsee: '02168',
        name: 'Château-Thierry',
        departementCode: '02',
        departementName: 'Aisne',
      },
    ]);
  });

  it('finds exactly one commune by exact active INSEE code', async () => {
    await prisma.commune.createMany({
      data: [
        commune('02168', 'Château-Thierry', '02', 'Aisne'),
        commune('02169', 'Chauny', '02', 'Aisne'),
      ],
    });

    const res = await search('02168');

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as Commune[];
    expect(body).toHaveLength(1);
    expect(body[0]?.codeInsee).toBe('02168');
  });

  it('finds a commune by a non-numeric Corsican INSEE code (2A004)', async () => {
    await prisma.commune.createMany({
      data: [
        commune('2A004', 'Ajaccio', '2A', 'Corse-du-Sud'),
        commune('2B033', 'Bastia', '2B', 'Haute-Corse'),
      ],
    });

    const res = await search('2A004');

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as Commune[];
    expect(body).toHaveLength(1);
    expect(body[0]?.name).toBe('Ajaccio');
  });

  it('returns an empty result for an expired INSEE code', async () => {
    await prisma.commune.createMany({
      data: [commune('14713', 'Vieux-Fumé', '14', 'Calvados', '2017-01-01')],
    });

    const res = await search('14713');

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
  });

  it('excludes expired communes from name-prefix search', async () => {
    await prisma.commune.createMany({
      data: [
        commune('19019', 'Beaulieu-sur-Dordogne', '19', 'Corrèze'),
        commune('34025', 'Beaulieu-le-Vieux', '34', 'Hérault', '2016-01-01'),
      ],
    });

    const res = await search('Beaulieu');

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as Commune[];
    expect(body).toHaveLength(1);
    expect(body[0]?.codeInsee).toBe('19019');
  });

  it(`caps the result at ${COMMUNE_SEARCH_LIMIT} communes sorted by name`, async () => {
    // Non-accented first letters on purpose: until phase 3 sorting uses raw
    // `name` and depends on the database collation.
    const names = 'abcdefghijkl'
      .split('')
      .map((letter) => `Test${letter}ville`);
    await prisma.commune.createMany({
      // Insert in reverse order so the sort is proven, not incidental.
      data: names
        .map((name, i) =>
          commune(
            `90${String(i + 1).padStart(3, '0')}`,
            name,
            '90',
            'Territoire de Belfort',
          ),
        )
        .reverse(),
    });

    const res = await search('Test');

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as Commune[];
    expect(body).toHaveLength(COMMUNE_SEARCH_LIMIT);
    expect(body.map((c) => c.name)).toEqual(
      names.slice(0, COMMUNE_SEARCH_LIMIT),
    );
  });

  it('is reachable without authentication', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/communes',
      query: { q: 'Paris' },
      // No Authorization header on purpose: the endpoint is public.
    });

    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['missing q', undefined],
    ['empty q', ''],
    ['single-character q', 'a'],
  ])('rejects %s with a validation error', async (_label, q) => {
    const res = await search(q);

    expect(res.statusCode).toBe(400);
  });
});
