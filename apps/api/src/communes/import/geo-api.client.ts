import type { FetchFn } from 'src/common/fetch-fn';

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

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * A record missing any required field fails the whole import — never a silent
 * skip of that record. Codes INSEE in the message are public data.
 */
function assertGeoApiCommune(
  record: unknown,
  index: number,
): asserts record is GeoApiCommune {
  if (typeof record !== 'object' || record === null) {
    throw new Error(`geo.api.gouv.fr record #${index} is not an object`);
  }
  const { code, nom, codeDepartement, departement } = record as Record<
    string,
    unknown
  >;
  const identity = isNonEmptyString(code)
    ? `#${index} (code ${code})`
    : `#${index}`;
  if (!isNonEmptyString(code)) {
    throw new Error(`geo.api.gouv.fr record ${identity} has no code`);
  }
  if (!isNonEmptyString(nom)) {
    throw new Error(`geo.api.gouv.fr record ${identity} has no nom`);
  }
  if (!isNonEmptyString(codeDepartement)) {
    throw new Error(
      `geo.api.gouv.fr record ${identity} has no codeDepartement`,
    );
  }
  const departementNom =
    typeof departement === 'object' && departement !== null
      ? (departement as Record<string, unknown>).nom
      : undefined;
  if (!isNonEmptyString(departementNom)) {
    throw new Error(
      `geo.api.gouv.fr record ${identity} has no departement.nom`,
    );
  }
}

export class GeoApiClient {
  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  /**
   * One request for the whole referential: the response is a single JSON
   * array without pagination (verified live on 2026-08-02), so a truncated
   * transfer yields invalid JSON and fails here rather than importing a
   * partial list.
   */
  async fetchCommunes(): Promise<GeoApiCommune[]> {
    const response = await this.fetchFn(GEO_API_COMMUNES_URL, {
      signal: AbortSignal.timeout(GEO_API_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`geo.api.gouv.fr responded with HTTP ${response.status}`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      // String(error) stays in the message: the seed logs message only,
      // while `cause` keeps the original error for programmatic consumers.
      throw new Error(
        'geo.api.gouv.fr response is not valid JSON — likely a truncated ' +
          `transfer: ${String(error)}`,
        { cause: error },
      );
    }
    if (!Array.isArray(payload)) {
      throw new Error(
        'geo.api.gouv.fr response is not a JSON array — the API format changed',
      );
    }
    const communes = payload.map((record, index): GeoApiCommune => {
      assertGeoApiCommune(record, index);
      return record;
    });
    if (communes.length < MIN_EXPECTED_COMMUNES) {
      throw new Error(
        `geo.api.gouv.fr returned ${communes.length} communes — below the ` +
          `expected minimum of ${MIN_EXPECTED_COMMUNES}, refusing a possibly ` +
          'truncated referential',
      );
    }
    return communes;
  }
}
