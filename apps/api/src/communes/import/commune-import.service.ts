import { PrismaClient } from 'src/generated/prisma/client';
import { GeoApiCommune } from './geo-api.client';

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

  run(): Promise<CommuneImportResult> {
    return Promise.reject(
      new Error('CommuneImportService.run: not implemented yet'),
    );
  }
}
