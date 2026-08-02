import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { COMMUNE_SEARCH_LIMIT, Commune } from '@mon-sinistre/contracts';
import { AppModule } from 'src/app.module';
import { createGlobalValidationPipe } from 'src/config/validation-pipe';
import { normalizeCommuneName } from 'src/communes/normalize-commune-name';
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
  // The search key is derived here exactly as the import derives it — a
  // fixture that filled it by hand could hide a mismatch between the two.
  nameNormalized: normalizeCommuneName(name),
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
    // The exact pipe main.ts installs — the validation behaviour under test.
    app.useGlobalPipes(createGlobalValidationPipe());
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
    // Non-accented names on purpose: raw and normalized order agree here, so
    // the test says nothing about which column the sort uses (accented order
    // is covered below, in the normalization suite).
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
    ['q longer than 64 characters', 'a'.repeat(65)],
  ])('rejects %s with a validation error', async (_label, q) => {
    const res = await search(q);

    expect(res.statusCode).toBe(400);
  });

  // People type "chateau" and expect "Château-Thierry": both sides of the
  // comparison go through normalizeCommuneName — the stored nameNormalized at
  // import time, the query at read time.
  describe('accent- and case-insensitive name search', () => {
    it.each(['chateau', 'CHATEAU', 'châTEAU', 'Chateau', 'Château'])(
      'finds "Château-Thierry" by q=%s',
      async (q) => {
        await prisma.commune.createMany({
          data: [
            commune('02168', 'Château-Thierry', '02', 'Aisne'),
            commune('75056', 'Paris', '75', 'Paris'),
          ],
        });

        const res = await search(q);

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
      },
    );

    it('returns homonymous communes together, told apart by département', async () => {
      await prisma.commune.createMany({
        data: [
          commune('05155', 'Sainte-Marie', '05', 'Hautes-Alpes'),
          commune('66186', 'Sainte-Marie', '66', 'Pyrénées-Orientales'),
        ],
      });

      const res = await search('sainte-marie');

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as Commune[];
      expect(body).toHaveLength(2);
      // Same name on both: the département is what makes them distinguishable.
      expect(body.map((c) => c.name)).toEqual(['Sainte-Marie', 'Sainte-Marie']);
      expect(
        body.map((c) => [c.departementCode, c.departementName]).sort(),
      ).toEqual([
        ['05', 'Hautes-Alpes'],
        ['66', 'Pyrénées-Orientales'],
      ]);
    });

    // Two pairs, because a single one only discriminates under one kind of
    // collation and the database behind CI is not the one running here:
    // byte-order collations (postgres:18-alpine is musl, so even en_US.utf8
    // compares bytes) sort É after every unaccented letter, while glibc/ICU
    // ignore the accent and the hyphen at the primary level. Each pair catches
    // a sort left on the raw `name` under one of the two.
    it.each([
      {
        label: 'an accent',
        q: 'et',
        // Under a byte-order collation É sorts after every unaccented letter,
        // so a sort on raw `name` returns the insert order below as is.
        data: [
          commune('17159', 'Etaules', '17', 'Charente-Maritime'),
          commune('91223', 'Étampes', '91', 'Essonne'),
        ],
        expected: ['Étampes', 'Etaules'],
      },
      {
        label: 'a hyphen',
        q: 'saint',
        data: [
          commune('05155', 'Sainte-Marie', '05', 'Hautes-Alpes'),
          commune('42218', 'Saint-Étienne', '42', 'Loire'),
        ],
        expected: ['Saint-Étienne', 'Sainte-Marie'],
      },
    ])(
      'sorts by the normalized name, not by the raw one ($label)',
      async ({ q, data, expected }) => {
        await prisma.commune.createMany({ data });

        const res = await search(q);

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.payload) as Commune[];
        expect(body.map((c) => c.name)).toEqual(expected);
      },
    );

    it('matches a prefix, not a substring', async () => {
      await prisma.commune.createMany({
        data: [commune('02168', 'Château-Thierry', '02', 'Aisne')],
      });

      const res = await search('thierry');

      expect(res.statusCode).toBe(200);
      // Normalization removes accents and case, nothing else: the search stays
      // a prefix match.
      expect(JSON.parse(res.payload)).toEqual([]);
    });

    it('accepts the typographic apostrophe phone keyboards produce', async () => {
      await prisma.commune.createMany({
        data: [commune('95313', "L'Isle-Adam", '95', "Val-d'Oise")],
      });

      const res = await search('l’isle');

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as Commune[];
      expect(body.map((c) => c.name)).toEqual(["L'Isle-Adam"]);
    });

    it('keeps the exact INSEE code branch working for 2A004', async () => {
      await prisma.commune.createMany({
        data: [commune('2A004', 'Ajaccio', '2A', 'Corse-du-Sud')],
      });

      // The code branch compares the raw q with codeInsee, which the import
      // stores as it comes from the COG — normalizing q would break it.
      const found = await search('2A004');
      expect(found.statusCode).toBe(200);
      expect(JSON.parse(found.payload)).toHaveLength(1);
    });

    it('still excludes expired communes from a normalized search', async () => {
      await prisma.commune.createMany({
        data: [
          commune('02168', 'Château-Thierry', '02', 'Aisne'),
          commune(
            '02999',
            'Château-le-Vieux',
            '02',
            'Aisne',
            // Expired: historical reference only, never searchable.
            '2016-01-01',
          ),
        ],
      });

      const res = await search('chateau');

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as Commune[];
      expect(body).toHaveLength(1);
      expect(body[0]?.codeInsee).toBe('02168');
    });

    it.each(['ch%', 'c_ateau', '%%'])(
      'treats LIKE wildcards in q=%s as ordinary characters',
      async (q) => {
        await prisma.commune.createMany({
          data: [commune('02168', 'Château-Thierry', '02', 'Aisne')],
        });

        const res = await search(q);

        expect(res.statusCode).toBe(200);
        // No commune name starts with these characters literally; unescaped,
        // each of them would match the seeded commune instead.
        expect(JSON.parse(res.payload)).toEqual([]);
      },
    );
  });
});
