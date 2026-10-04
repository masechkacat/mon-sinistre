import { REMINDER_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { expect, test } from '@playwright/test';
import {
  oneClickPost,
  withMockUnsubscribeApi,
} from '../support/unsubscribe-api';

// The handlers themselves are covered in tests/app/one-click-unsubscribe.spec.ts;
// here it is the mounting that is under test — that the link carried by the
// reminder mail lands on them, on the reminders endpoint and the reminders
// confirm page.

test('POST unsubscribes the token of the link and answers success', async ({
  request,
}) => {
  await withMockUnsubscribeApi(async (received) => {
    const response = await oneClickPost(
      request,
      `${REMINDER_UNSUBSCRIBE_PATH}?token=jeton-one-click`,
    );

    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('');

    expect(received()?.method).toBe('POST');
    expect(received()?.url).toBe('/rappels/desinscription');
    expect(JSON.parse(received()?.body ?? '{}')).toEqual({
      token: 'jeton-one-click',
    });
  });
});

test('POST does not answer 200 when the API refuses', async ({ request }) => {
  await withMockUnsubscribeApi(async (received) => {
    const response = await oneClickPost(
      request,
      `${REMINDER_UNSUBSCRIBE_PATH}?token=jeton-refuse`,
    );

    expect(response.status()).not.toBe(200);
    expect(await response.text()).toBe('');
    expect(received()?.method).toBe('POST');
  }, 429);
});

test('GET redirects to the confirm page with the same token and leaves the API alone', async ({
  request,
}) => {
  await withMockUnsubscribeApi(async (received) => {
    const response = await request.get(
      `${REMINDER_UNSUBSCRIBE_PATH}?token=jeton lien`,
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toBe(
      `${REMINDER_UNSUBSCRIBE_PATH}/confirmer?token=jeton%20lien`,
    );

    expect(received()).toBeNull();
  });
});
