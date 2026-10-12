import { expect, test } from '@playwright/test';
import { veilleConfirmation } from '../support/pages';

test('/veille is permanently redirected to the home page', async ({
  request,
}) => {
  const response = await request.get('/veille', { maxRedirects: 0 });

  expect(response.status()).toBe(308);
  expect(response.headers()['location']).toBe('/');
});

test('a subpage of /veille is left alone by the redirect', async ({
  request,
}) => {
  const response = await request.get(veilleConfirmation.path, {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(200);
});
