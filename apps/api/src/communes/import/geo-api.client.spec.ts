import {
  GEO_API_COMMUNES_URL,
  GeoApiClient,
  GeoApiCommune,
  MIN_EXPECTED_COMMUNES,
} from './geo-api.client';

// Enough valid records to clear the completeness floor, generated in memory —
// this suite never talks to the network or the database.
const makeCommunes = (count: number): GeoApiCommune[] =>
  Array.from({ length: count }, (_, i) => ({
    code: String(i + 1).padStart(5, '0'),
    nom: `Commune ${i + 1}`,
    codeDepartement: '01',
    departement: { nom: 'Ain' },
  }));

const fetchOf = (body: unknown, status = 200) =>
  jest.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );

describe('GeoApiClient', () => {
  it('returns the full commune list with the département name', async () => {
    const communes = [
      ...makeCommunes(MIN_EXPECTED_COMMUNES),
      {
        code: '2A004',
        nom: 'Ajaccio',
        codeDepartement: '2A',
        departement: { nom: 'Corse-du-Sud' },
      },
    ];
    const fetchFn = fetchOf(communes);

    const result = await new GeoApiClient(fetchFn).fetchCommunes();

    expect(fetchFn).toHaveBeenCalledWith(
      GEO_API_COMMUNES_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) as unknown }),
    );
    expect(result).toHaveLength(MIN_EXPECTED_COMMUNES + 1);
    expect(result.at(-1)).toEqual({
      code: '2A004',
      nom: 'Ajaccio',
      codeDepartement: '2A',
      departement: { nom: 'Corse-du-Sud' },
    });
  });

  it.each(['code', 'nom', 'codeDepartement'] as const)(
    'rejects the whole import when a record has no %s',
    async (field) => {
      const communes = makeCommunes(MIN_EXPECTED_COMMUNES + 1);
      const broken = communes[1000] as unknown as Record<string, unknown>;
      delete broken[field];

      const client = new GeoApiClient(fetchOf(communes));

      await expect(client.fetchCommunes()).rejects.toThrow(field);
    },
  );

  it('rejects the whole import when a record has no departement.nom', async () => {
    const communes: unknown[] = makeCommunes(MIN_EXPECTED_COMMUNES + 1);
    communes[1000] = {
      code: '99999',
      nom: 'Sans-Département',
      codeDepartement: '99',
      departement: {},
    };

    const client = new GeoApiClient(fetchOf(communes));

    await expect(client.fetchCommunes()).rejects.toThrow('departement.nom');
  });

  it('rejects a response shorter than MIN_EXPECTED_COMMUNES', async () => {
    const client = new GeoApiClient(
      fetchOf(makeCommunes(MIN_EXPECTED_COMMUNES - 1)),
    );

    await expect(client.fetchCommunes()).rejects.toThrow(
      String(MIN_EXPECTED_COMMUNES),
    );
  });

  it('accepts a response of exactly MIN_EXPECTED_COMMUNES records', async () => {
    const client = new GeoApiClient(
      fetchOf(makeCommunes(MIN_EXPECTED_COMMUNES)),
    );

    await expect(client.fetchCommunes()).resolves.toHaveLength(
      MIN_EXPECTED_COMMUNES,
    );
  });

  it('rejects a non-2xx response', async () => {
    const client = new GeoApiClient(fetchOf([], 503));

    await expect(client.fetchCommunes()).rejects.toThrow('503');
  });

  it('rejects a truncated response body that is not valid JSON', async () => {
    const fetchFn = jest.fn(() =>
      Promise.resolve(new Response('[{"code":"01001"', { status: 200 })),
    );

    await expect(new GeoApiClient(fetchFn).fetchCommunes()).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it('rejects a response that is not a JSON array', async () => {
    const client = new GeoApiClient(fetchOf({ message: 'maintenance' }));

    await expect(client.fetchCommunes()).rejects.toThrow(/JSON array/);
  });
});
