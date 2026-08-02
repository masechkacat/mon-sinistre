import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { COMMUNE_SEARCH_LIMIT, Commune } from '@mon-sinistre/contracts';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Integration tests for GET /communes?q= (plan phase 1) against the real
 * test database. Phase 1 searches by exact prefix — diacritics-insensitive
 * matching arrives in phase 3, so fixtures here use plain first letters
 * where ordering matters (sort is by `name` and depends on DB collation).
 */
describe('GET /communes', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const reference = {
    sourceUrl: 'https://geo.api.gouv.fr/communes',
    sourceVerifiedAt: new Date('2026-08-02'),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // Same global pipe as main.ts — validation behaviour must match production.
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
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Commune" CASCADE');
  });

  const search = (q?: string) =>
    app.inject({
      method: 'GET',
      url: '/communes',
      query: q === undefined ? {} : { q },
    });

  it('находит коммуну по началу названия, без аутентификации, с названием и département', async () => {
    await prisma.commune.createMany({
      data: [
        {
          codeInsee: '02168',
          name: 'Château-Thierry',
          departementCode: '02',
          departementName: 'Aisne',
          ...reference,
        },
        {
          codeInsee: '30189',
          name: 'Nîmes',
          departementCode: '30',
          departementName: 'Gard',
          ...reference,
        },
      ],
    });

    // No Authorization header anywhere in this file: the endpoint is public.
    const response = await search('Châ');

    expect(response.statusCode).toBe(200);
    const body = response.json<Commune[]>();
    expect(body).toEqual([
      {
        codeInsee: '02168',
        name: 'Château-Thierry',
        departementCode: '02',
        departementName: 'Aisne',
      },
    ]);
  });

  it('находит ровно одну коммуну по точному действующему коду INSEE', async () => {
    await prisma.commune.createMany({
      data: [
        {
          codeInsee: '02168',
          name: 'Château-Thierry',
          departementCode: '02',
          departementName: 'Aisne',
          ...reference,
        },
        {
          codeInsee: '02169',
          name: 'Châtillon-lès-Sons',
          departementCode: '02',
          departementName: 'Aisne',
          ...reference,
        },
      ],
    });

    const response = await search('02168');

    expect(response.statusCode).toBe(200);
    const body = response.json<Commune[]>();
    expect(body).toHaveLength(1);
    expect(body[0]?.codeInsee).toBe('02168');
  });

  it('находит корсиканский код 2A004 — коды INSEE не только цифровые', async () => {
    await prisma.commune.create({
      data: {
        codeInsee: '2A004',
        name: 'Ajaccio',
        departementCode: '2A',
        departementName: 'Corse-du-Sud',
        ...reference,
      },
    });

    const response = await search('2A004');

    expect(response.statusCode).toBe(200);
    const body = response.json<Commune[]>();
    expect(body).toEqual([
      {
        codeInsee: '2A004',
        name: 'Ajaccio',
        departementCode: '2A',
        departementName: 'Corse-du-Sud',
      },
    ]);
  });

  it('не находит по коду INSEE коммуну с заполненным effectiveTo', async () => {
    await prisma.commune.create({
      data: {
        codeInsee: '14624',
        name: 'Sainte-Marie-aux-Anglais',
        departementCode: '14',
        departementName: 'Calvados',
        effectiveTo: new Date('2017-01-01'),
        ...reference,
      },
    });

    const response = await search('14624');

    expect(response.statusCode).toBe(200);
    expect(response.json<Commune[]>()).toEqual([]);
  });

  it('исключает коммуны с заполненным effectiveTo из поиска по названию', async () => {
    await prisma.commune.createMany({
      data: [
        {
          codeInsee: '14624',
          name: 'Sainte-Marie-aux-Anglais',
          departementCode: '14',
          departementName: 'Calvados',
          effectiveTo: new Date('2017-01-01'),
          ...reference,
        },
        {
          codeInsee: '97418',
          name: 'Sainte-Marie',
          departementCode: '974',
          departementName: 'La Réunion',
          ...reference,
        },
      ],
    });

    const response = await search('Sainte-Marie');

    expect(response.statusCode).toBe(200);
    const body = response.json<Commune[]>();
    expect(body).toHaveLength(1);
    expect(body[0]?.codeInsee).toBe('97418');
  });

  it(`возвращает не больше ${COMMUNE_SEARCH_LIMIT} коммун, отсортированных по названию`, async () => {
    // 12 communes, plain ASCII first letters: phase-1 sort is collation-driven.
    const codes = Array.from({ length: 12 }, (_, i) =>
      String(10001 + i).padStart(5, '0'),
    );
    await prisma.commune.createMany({
      data: codes.map((codeInsee, i) => ({
        codeInsee,
        name: `Beaune-${String(i + 1).padStart(2, '0')}`,
        departementCode: '21',
        departementName: "Côte-d'Or",
        ...reference,
      })),
    });

    const response = await search('Beaune');

    expect(response.statusCode).toBe(200);
    const names = response.json<Commune[]>().map((c) => c.name);
    expect(names).toHaveLength(COMMUNE_SEARCH_LIMIT);
    expect(names).toEqual(
      Array.from(
        { length: COMMUNE_SEARCH_LIMIT },
        (_, i) => `Beaune-${String(i + 1).padStart(2, '0')}`,
      ),
    );
  });

  it('отклоняет запрос без q', async () => {
    const response = await search(undefined);

    expect(response.statusCode).toBe(400);
  });

  it('отклоняет q короче двух символов', async () => {
    const response = await search('a');

    expect(response.statusCode).toBe(400);
  });

  it('отклоняет q из пробелов, схлопывающийся короче двух символов', async () => {
    const response = await search('  a  ');

    expect(response.statusCode).toBe(400);
  });
});
