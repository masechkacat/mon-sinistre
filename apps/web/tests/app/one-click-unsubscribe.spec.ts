import { NextRequest } from 'next/server';
import { expect, test } from '@playwright/test';
import { oneClickUnsubscribeHandlers } from '../../src/lib/one-click-unsubscribe';

// The injected `unsubscribe` is the factory's only tie to the outside world,
// so a fake one needs neither a browser nor a listener on testApiBaseUrl —
// unlike the route specs that mount these handlers (tests/veille).
const CONFIRM_PATH = '/essai/desinscription/confirmer';

function linkRequest(method: 'GET' | 'POST', token: string) {
  return new NextRequest(
    `https://exemple.fr/essai/desinscription?token=${encodeURIComponent(token)}`,
    { method },
  );
}

test('POST passes the token of the link to the API and answers success', async () => {
  const tokens: string[] = [];
  const { POST } = oneClickUnsubscribeHandlers({
    unsubscribe: (token) => {
      tokens.push(token);
      return Promise.resolve();
    },
    confirmPath: CONFIRM_PATH,
  });

  const response = await POST(linkRequest('POST', 'jeton-one-click'));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe('');
  expect(tokens).toEqual(['jeton-one-click']);
});

test('POST does not answer 200 when the API refuses', async () => {
  const { POST } = oneClickUnsubscribeHandlers({
    unsubscribe: () => Promise.reject(new Error('API 429')),
    confirmPath: CONFIRM_PATH,
  });

  const response = await POST(linkRequest('POST', 'jeton-refuse'));

  expect(response.status).not.toBe(200);
  expect(await response.text()).toBe('');
});

test('GET redirects to the confirm page with the same token and leaves the API alone', async () => {
  let called = false;
  const { GET } = oneClickUnsubscribeHandlers({
    unsubscribe: () => {
      called = true;
      return Promise.resolve();
    },
    confirmPath: CONFIRM_PATH,
  });

  const response = GET(linkRequest('GET', 'jeton lien'));

  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe(
    `${CONFIRM_PATH}?token=jeton%20lien`,
  );
  expect(called).toBe(false);
});
