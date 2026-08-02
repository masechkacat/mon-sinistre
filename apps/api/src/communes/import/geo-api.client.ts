/**
 * Client for the geo.api.gouv.fr commune referential — the single source the
 * COG import reads from (decision: docs/research/commune-referential.md).
 * A plain class, not a Nest provider: the seed script instantiates it without
 * an application context.
 */

/** One record of GET /communes with fields=code,nom,codeDepartement,departement. */
export interface GeoApiCommune {
  code: string;
  nom: string;
  codeDepartement: string;
  departement: { nom: string };
}

/**
 * The exact request URL; the import stamps it on every row as sourceUrl.
 * fields=departement embeds the département name in each record, so no
 * separate /departements request or join is needed.
 */
export const GEO_API_COMMUNES_URL =
  'https://geo.api.gouv.fr/communes?fields=code,nom,codeDepartement,departement&format=json';

/**
 * Completeness floor: the live COG counts ~35 000 communes (34 969 on
 * 2026-08-02). A shorter — yet valid — JSON array means a truncated response
 * or an API format change, and must fail the import rather than silently
 * shrink the referential. An import constant, not a legal deadline: it does
 * not belong in DeadlineRule.
 */
export const MIN_EXPECTED_COMMUNES = 30_000;

/** One ~4 MB response for the whole country; generous timeout for slow links. */
export const GEO_API_TIMEOUT_MS = 60_000;

export type FetchFn = typeof globalThis.fetch;

export class GeoApiClient {
  /** fetchFn is injectable so tests mock HTTP without nock/msw. */
  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  fetchCommunes(): Promise<GeoApiCommune[]> {
    return Promise.reject(
      new Error('GeoApiClient.fetchCommunes: not implemented yet'),
    );
  }
}
