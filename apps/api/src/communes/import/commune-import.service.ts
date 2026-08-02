import { PrismaClient } from 'src/generated/prisma/client';
import { GEO_API_COMMUNES_URL, GeoApiCommune } from './geo-api.client';

/**
 * What the import needs from the outside world — GeoApiClient satisfies it
 * structurally; tests substitute an in-memory source.
 */
export interface CommuneImportSource {
  fetchCommunes(): Promise<GeoApiCommune[]>;
}

export interface CommuneImportResult {
  /** Successfully completed upserts — must equal `total` for a valid run. */
  processed: number;
  /** Communes received from the source. */
  total: number;
}

/**
 * Upserts run in chunks of this size (Promise.allSettled inside a chunk,
 * chunks sequentially) — docs/research/commune-referential.md.
 */
export const IMPORT_CHUNK_SIZE = 500;

/**
 * Idempotent COG import: upsert by codeInsee, never deletes codes that
 * disappeared from the source. A plain class (no Nest context): the seed
 * script wires PrismaClient and GeoApiClient directly.
 */
export class CommuneImportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly source: CommuneImportSource,
  ) {}

  async run(): Promise<CommuneImportResult> {
    const communes = await this.source.fetchCommunes();
    // Day precision at UTC midnight: the run date lands in a `date` column
    // (domain rule for dates), so no timezone component may leak into it.
    const sourceVerifiedAt = new Date(
      `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
    );

    let processed = 0;
    for (let i = 0; i < communes.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = communes.slice(i, i + IMPORT_CHUNK_SIZE);
      const settled = await Promise.allSettled(
        chunk.map((commune) => this.upsert(commune, sourceVerifiedAt)),
      );
      processed += settled.filter(
        (result) => result.status === 'fulfilled',
      ).length;
    }

    return { processed, total: communes.length };
  }

  private async upsert(
    commune: GeoApiCommune,
    sourceVerifiedAt: Date,
  ): Promise<void> {
    const fields = {
      name: commune.nom,
      departementCode: commune.codeDepartement,
      departementName: commune.departement.nom,
      sourceUrl: GEO_API_COMMUNES_URL,
      sourceVerifiedAt,
    };
    await this.prisma.commune.upsert({
      where: { codeInsee: commune.code },
      create: { codeInsee: commune.code, ...fields },
      // Deliberately without effectiveTo/successorCodeInsee: the future
      // actualisation logic owns those fields, the import never resets them.
      update: fields,
    });
  }
}
