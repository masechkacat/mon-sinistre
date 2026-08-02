import type { PrismaClient } from 'src/generated/prisma/client';
import {
  CommuneImportService,
  CommuneImportSource,
} from './commune-import.service';
import { GeoApiCommune } from './geo-api.client';

// Pure-logic suite (mocked Prisma, no database): the real persistence paths
// are covered by commune-import.int-spec.ts.

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

const sourceOf = (communes: GeoApiCommune[]): CommuneImportSource => ({
  fetchCommunes: () => Promise.resolve(communes),
});

describe('CommuneImportService', () => {
  it('fails with a count mismatch error when an upsert is lost', async () => {
    // A silently lost write cannot be provoked through the real client —
    // simulate it at the Prisma boundary: one upsert rejects, the rest pass.
    const upsert = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection reset by peer'))
      .mockResolvedValue({});
    const losingPrisma = { commune: { upsert } } as unknown as PrismaClient;
    const service = new CommuneImportService(
      losingPrisma,
      sourceOf([
        geoCommune('01001', "L'Abergement-Clémenciat", '01', 'Ain'),
        geoCommune('01002', "L'Abergement-de-Varey", '01', 'Ain'),
        geoCommune('01004', 'Ambérieu-en-Bugey', '01', 'Ain'),
      ]),
    );

    await expect(service.run()).rejects.toThrow('2 of 3');
  });
});
