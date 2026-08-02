import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'src/generated/prisma/client';
import { buildDatabaseUrl } from 'src/prisma/database-url';
import {
  CommuneImportService,
  CommuneImportSource,
} from './commune-import.service';
import { GEO_API_COMMUNES_URL, GeoApiCommune } from './geo-api.client';

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set for integration tests`);
  }
  return value;
};

const geoCommune = (
  code: string,
  nom: string,
  codeDepartement: string,
  departementNom: string,
): GeoApiCommune => ({
  code,
  nom,
  codeDepartement,
  departement: { nom: departementNom },
});

// The import is tested against an in-memory source: the HTTP layer (including
// the completeness floor) has its own suite in geo-api.client.spec.ts.
const sourceOf = (communes: GeoApiCommune[]): CommuneImportSource => ({
  fetchCommunes: () => Promise.resolve(communes),
});

describe('CommuneImportService (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    // No Nest context on purpose — the seed script will wire the service the
    // same way (docs/research/commune-referential.md, «Архитектура seed»).
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: buildDatabaseUrl({
          host: requiredEnv('DB_HOST'),
          port: requiredEnv('DB_PORT'),
          user: requiredEnv('DB_USER'),
          password: requiredEnv('DB_PASSWORD'),
          database: requiredEnv('DB_NAME'),
        }),
      }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Commune" CASCADE`;
  });

  const importOf = (communes: GeoApiCommune[]) =>
    new CommuneImportService(prisma, sourceOf(communes)).run();

  it('fills an empty database, stamping every row with source and verification date', async () => {
    // Two candidate dates so a UTC-midnight crossing mid-test cannot flake.
    const before = new Date().toISOString().slice(0, 10);

    const result = await importOf([
      geoCommune('02168', 'Château-Thierry', '02', 'Aisne'),
      geoCommune('2A004', 'Ajaccio', '2A', 'Corse-du-Sud'),
    ]);
    const after = new Date().toISOString().slice(0, 10);

    expect(result).toEqual({ processed: 2, total: 2 });
    const rows = await prisma.commune.findMany({
      orderBy: { codeInsee: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      codeInsee: '02168',
      name: 'Château-Thierry',
      departementCode: '02',
      departementName: 'Aisne',
      sourceUrl: GEO_API_COMMUNES_URL,
      effectiveTo: null,
      successorCodeInsee: null,
    });
    for (const row of rows) {
      expect([before, after]).toContain(
        row.sourceVerifiedAt.toISOString().slice(0, 10),
      );
    }
  });

  it('does not create duplicates on a repeated identical import', async () => {
    const communes = [
      geoCommune('02168', 'Château-Thierry', '02', 'Aisne'),
      geoCommune('75056', 'Paris', '75', 'Paris'),
    ];

    await importOf(communes);
    const second = await importOf(communes);

    expect(second).toEqual({ processed: 2, total: 2 });
    expect(await prisma.commune.count()).toBe(2);
  });

  it('updates a changed name in place for the same code', async () => {
    await importOf([geoCommune('14713', 'Vieux-Fumé', '14', 'Calvados')]);

    await importOf([geoCommune('14713', 'Val-de-Fumé', '14', 'Calvados')]);

    const rows = await prisma.commune.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Val-de-Fumé');
  });

  it('keeps codes that disappeared from the source untouched', async () => {
    await prisma.commune.create({
      data: {
        codeInsee: '08053',
        name: 'Bazeilles',
        departementCode: '08',
        departementName: 'Ardennes',
        sourceUrl: GEO_API_COMMUNES_URL,
        sourceVerifiedAt: new Date('2026-01-01'),
      },
    });

    const result = await importOf([
      geoCommune('08105', 'Charleville-Mézières', '08', 'Ardennes'),
    ]);

    // The reconciliation counts processed records only — the leftover row
    // must neither be deleted nor fail the run.
    expect(result).toEqual({ processed: 1, total: 1 });
    const kept = await prisma.commune.findUnique({
      where: { codeInsee: '08053' },
    });
    expect(kept?.name).toBe('Bazeilles');
    expect(kept?.sourceVerifiedAt.toISOString().slice(0, 10)).toBe(
      '2026-01-01',
    );
  });

  it('never touches effectiveTo and successorCodeInsee on update', async () => {
    // An expired code pointing at its commune nouvelle: a future
    // actualisation fills these fields, the import must not reset them.
    await prisma.commune.create({
      data: {
        codeInsee: '14712',
        name: 'Val-de-Fumé',
        departementCode: '14',
        departementName: 'Calvados',
        sourceUrl: GEO_API_COMMUNES_URL,
        sourceVerifiedAt: new Date('2026-01-01'),
      },
    });
    await prisma.commune.create({
      data: {
        codeInsee: '14713',
        name: 'Vieux-Fumé',
        departementCode: '14',
        departementName: 'Calvados',
        effectiveTo: new Date('2017-01-01'),
        successorCodeInsee: '14712',
        sourceUrl: GEO_API_COMMUNES_URL,
        sourceVerifiedAt: new Date('2026-01-01'),
      },
    });

    await importOf([
      geoCommune('14712', 'Val-de-Fumé', '14', 'Calvados'),
      geoCommune('14713', 'Vieux-Fumé', '14', 'Calvados'),
    ]);

    const updated = await prisma.commune.findUnique({
      where: { codeInsee: '14713' },
    });
    expect(updated?.effectiveTo?.toISOString().slice(0, 10)).toBe('2017-01-01');
    expect(updated?.successorCodeInsee).toBe('14712');
  });

  it('imports more communes than one chunk and reconciles the count', async () => {
    const many = Array.from({ length: 1201 }, (_, i) =>
      geoCommune(String(10000 + i), `Ville ${i + 1}`, '01', 'Ain'),
    );

    const result = await importOf(many);

    expect(result).toEqual({ processed: 1201, total: 1201 });
    expect(await prisma.commune.count()).toBe(1201);
  });
});
