import { expect, test } from '@playwright/test';

// Account mails are transactional, so the List-Unsubscribe target has nothing
// to cancel: the one-click POST must still answer success, or mail clients
// flag the sender; a person following the footer link lands on the home page.

test('POST answers an empty 200 to the one-click unsubscribe', async ({
  request,
}) => {
  const response = await request.post('/compte/desabonnement', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: 'List-Unsubscribe=One-Click',
    maxRedirects: 0,
  });

  expect(response.status()).toBe(200);
  expect(response.headers()['location']).toBeUndefined();
  expect(await response.text()).toBe('');
});

test('GET redirects a human to the home page', async ({ request }) => {
  const response = await request.get('/compte/desabonnement', {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(307);
  expect(response.headers()['location']).toBe('/');
});
