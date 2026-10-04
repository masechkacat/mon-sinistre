import { expect, test } from '@playwright/test';
import {
  oneClickPost,
  withMockUnsubscribeApi,
} from '../support/unsubscribe-api';

test('POST unsubscribes without cookie or CSRF token and answers success without a redirect or HTML', async ({
  request,
}) => {
  await withMockUnsubscribeApi(async (received) => {
    const response = await oneClickPost(
      request,
      '/veille/desinscription?token=jeton-one-click',
    );

    expect(response.status()).toBe(200);
    expect(response.headers()['location']).toBeUndefined();
    expect(response.headers()['content-type']).toBeUndefined();
    expect(await response.text()).toBe('');

    expect(received()?.method).toBe('POST');
    expect(JSON.parse(received()?.body ?? '{}')).toEqual({
      token: 'jeton-one-click',
    });
  });
});

test('GET does not call the API and redirects to the button page', async ({
  request,
}) => {
  await withMockUnsubscribeApi(async (received) => {
    const response = await request.get(
      '/veille/desinscription?token=jeton-lien',
      { maxRedirects: 0 },
    );

    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    // Rooted, not absolute — why: src/lib/one-click-unsubscribe.ts, GET.
    expect(response.headers()['location']).toBe(
      '/veille/desinscription/confirmer?token=jeton-lien',
    );

    expect(received()).toBeNull();
  });
});

test('an unknown token gives the client no error on either method', async ({
  request,
}) => {
  await withMockUnsubscribeApi(async () => {
    const postResponse = await oneClickPost(
      request,
      '/veille/desinscription?token=jeton-inconnu',
    );
    expect(postResponse.status()).toBe(200);

    const getResponse = await request.get(
      '/veille/desinscription?token=jeton-inconnu',
      { maxRedirects: 0 },
    );
    expect(getResponse.status()).toBeGreaterThanOrEqual(300);
    expect(getResponse.status()).toBeLessThan(400);
  });
});

test('an API that refuses the deletion answers the mail client 502, not a false success', async ({
  request,
}) => {
  await withMockUnsubscribeApi(async (received) => {
    const response = await oneClickPost(
      request,
      '/veille/desinscription?token=jeton-refuse',
    );

    expect(response.status()).toBe(502);
    expect(await response.text()).toBe('');
    expect(received()?.method).toBe('POST');
  }, 429);
});

test('an unreachable API answers 502 too, without an HTML error page', async ({
  request,
}) => {
  await withMockUnsubscribeApi(async () => {
    const response = await oneClickPost(
      request,
      '/veille/desinscription?token=jeton-injoignable',
    );

    expect(response.status()).toBe(502);
    expect(await response.text()).toBe('');
  }, 'unreachable');
});
