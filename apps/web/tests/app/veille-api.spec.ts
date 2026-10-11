import { expect, test } from '@playwright/test';
import { subscribeVeille } from '../../src/lib/api/veille';
import { NIMES } from '../support/communes';
import { withMockApi } from '../support/mock-api';

// No page: the layer is called from the test process and answered by a
// listener on the API address (support/mock-api.ts), so what it sends stays
// asserted as the screens offering the subscription come and go.

test('a subscription posts the watched commune codes and the trimmed address', async () => {
  await withMockApi(async (received) => {
    await subscribeVeille('  Jeanne.Dupont@exemple.fr  ', [NIMES.codeInsee]);

    const request = received();
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/veille');
    expect(request?.contentType).toBe('application/json');
    expect(JSON.parse(request?.body ?? '')).toEqual({
      email: 'Jeanne.Dupont@exemple.fr',
      communeCodes: ['30189'],
    });
  });
});
