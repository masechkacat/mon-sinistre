import { createServer, type IncomingMessage, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import { testApiBaseUrl } from '../support/env';

// route.ts runs server-side (the web app's own Node process), so unlike the
// browser-side calls covered elsewhere, page.route cannot intercept it —
// nothing else listens on testApiBaseUrl during `npm run test:web` (env.ts),
// so these tests stand up a real listener there for the handler to reach.
const { hostname, port } = new URL(testApiBaseUrl);

type ReceivedRequest = {
  method?: string;
  url?: string;
  contentType?: string;
  body: string;
};

async function withMockUnsubscribeApi(
  run: (received: () => ReceivedRequest | null) => Promise<void>,
  apiStatus = 204,
) {
  let received: ReceivedRequest | null = null;
  const server: Server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received = {
        method: req.method,
        url: req.url,
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      };
      res.writeHead(apiStatus);
      res.end();
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(Number(port), hostname, resolve),
  );
  try {
    await run(() => received);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('POST unsubscribes without cookie or CSRF token and answers success without a redirect or HTML', async ({
  request,
}) => {
  await withMockUnsubscribeApi(async (received) => {
    const response = await request.post(
      '/veille/desinscription?token=jeton-one-click',
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: 'List-Unsubscribe=One-Click',
        maxRedirects: 0,
      },
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
    // Rooted, not absolute: an absolute Location would carry the origin the
    // server thinks it has, and behind a proxy that is its own socket address
    // — the reader of the email would land on localhost.
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
    const postResponse = await request.post(
      '/veille/desinscription?token=jeton-inconnu',
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: 'List-Unsubscribe=One-Click',
        maxRedirects: 0,
      },
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

// The two failures the handler must survive: a refusal (rate limit, restart)
// and an API that does not answer at all.
test('an API that refuses the deletion answers the mail client 502, not a false success', async ({
  request,
}) => {
  await withMockUnsubscribeApi(async (received) => {
    const response = await request.post(
      '/veille/desinscription?token=jeton-refuse',
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: 'List-Unsubscribe=One-Click',
        maxRedirects: 0,
      },
    );

    expect(response.status()).toBe(502);
    expect(await response.text()).toBe('');
    expect(received()?.method).toBe('POST');
  }, 429);
});

test('an unreachable API answers 502 too, without an HTML error page', async ({
  request,
}) => {
  // No listener stood up on purpose: nothing else answers on testApiBaseUrl.
  const response = await request.post(
    '/veille/desinscription?token=jeton-injoignable',
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: 'List-Unsubscribe=One-Click',
      maxRedirects: 0,
    },
  );

  expect(response.status()).toBe(502);
  expect(await response.text()).toBe('');
});
