import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { APIRequestContext } from '@playwright/test';
import { testApiBaseUrl } from './env';

// route.ts runs server-side (the web app's own Node process), so unlike the
// browser-side calls covered elsewhere, page.route cannot intercept it — the
// route specs of the unsubscribe links stand up a real listener on the API
// address baked into the build (env.ts) for the handler to reach.
const { hostname, port } = new URL(testApiBaseUrl);

const BIND_TIMEOUT_MS = 10_000;

export type ReceivedRequest = {
  method?: string;
  url?: string;
  contentType?: string;
  body: string;
};

export type MockApiAnswer = number | 'unreachable';

// Every mailing's route spec needs that one address, and Playwright runs their
// files in parallel workers: whoever gets there second waits the other file
// out instead of failing on EADDRINUSE. `listen` is callable again after that
// error — the server never came up.
async function listenOnApiPort(server: Server) {
  const deadline = Date.now() + BIND_TIMEOUT_MS;
  for (;;) {
    const busy = await new Promise<boolean>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) =>
        error.code === 'EADDRINUSE' ? resolve(true) : reject(error);
      server.once('error', onError);
      server.listen(Number(port), hostname, () => {
        server.off('error', onError);
        resolve(false);
      });
    });
    if (!busy) return;
    if (Date.now() > deadline)
      throw new Error(
        `${testApiBaseUrl} is still taken after ${BIND_TIMEOUT_MS} ms`,
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * A listener stands up even for `'unreachable'`: a spec that counted on nobody
 * answering would be answered by the mock of whichever route spec runs beside
 * it.
 */
export async function withMockUnsubscribeApi(
  run: (received: () => ReceivedRequest | null) => Promise<void>,
  answer: MockApiAnswer = 204,
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
      if (answer === 'unreachable') {
        res.destroy();
        return;
      }
      res.writeHead(answer);
      res.end();
    });
  });
  try {
    await listenOnApiPort(server);
    await run(() => received);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** The request a mail client sends — why: src/lib/one-click-unsubscribe.ts. */
export function oneClickPost(request: APIRequestContext, url: string) {
  return request.post(url, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: 'List-Unsubscribe=One-Click',
    maxRedirects: 0,
  });
}
