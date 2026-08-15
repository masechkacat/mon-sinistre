import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { COMMUNE_SEARCH_LIMIT, Commune } from '@mon-sinistre/contracts';
import { createIntTestApp } from 'src/app.int-helper';
import {
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
} from 'src/communes/dto/search-communes-query.dto';
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
    app = await createIntTestApp();
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
    // Both are one character off the bound, taken from the constants that set
    // it: the case is "just outside what we accept", not "64", and a label
    // spelling the number out goes stale the day the bound moves.
    [
      `q shorter than ${MIN_QUERY_LENGTH} characters`,
      'a'.repeat(MIN_QUERY_LENGTH - 1),
    ],
    [
      `q longer than ${MAX_QUERY_LENGTH} characters`,
      'a'.repeat(MAX_QUERY_LENGTH + 1),
    ],
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

    // Two pairs: one catches a sort left on the raw `name` through the accent,
    // the other through the hyphen. Both expectations are byte order, which is
    // what the column declares (COLLATE "C", migration normalize_collation) —
    // and therefore what CI will see too, whichever image runs Postgres there.
    // Before that collation was pinned, the hyphen pair passed on musl and ICU
    // and failed on glibc, which ignores a hyphen at the primary level.
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

    it.each(['2A004', '2a004'])(
      'finds the Corsican commune by INSEE code q=%s whatever the case',
      async (q) => {
        await prisma.commune.createMany({
          data: [commune('2A004', 'Ajaccio', '2A', 'Corse-du-Sud')],
        });

        // Codes are stored as the COG delivers them, uppercase; a phone
        // keyboard types "2a004". The code branch upper-cases q instead of
        // normalizing it — normalization is for names and would not help here.
        const found = await search(q);
        expect(found.statusCode).toBe(200);
        const body = JSON.parse(found.payload) as Commune[];
        expect(body).toHaveLength(1);
        expect(body[0]?.name).toBe('Ajaccio');
      },
    );

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

    it('treats a backslash in q as an ordinary character', async () => {
      // The backslash is the one wildcard whose handling depends on order:
      // escaped after % and _, it would escape the escapes added before it.
      // No French commune contains one, so the discriminating fixture is
      // synthetic — without escaping, the pattern "test\%" would ask Postgres
      // for a literal per cent and match neither row, passing the test for the
      // wrong reason. Here the escaped pattern must match exactly one.
      await prisma.commune.createMany({
        data: [
          commune('99001', 'Test\\Ville', '99', 'Test'),
          commune('99002', 'TestXVille', '99', 'Test'),
        ],
      });

      const res = await search('test\\');

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as Commune[];
      expect(body.map((c) => c.name)).toEqual(['Test\\Ville']);
    });
  });
});
