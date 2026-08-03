import type { ConfigService } from '@nestjs/config';

import { MailComposer } from 'src/mail/mail-composer';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { MailMessage } from 'src/mail/mail-message';
import { MailService } from 'src/mail/mail.service';
import {
  SCALEWAY_TEM_TIMEOUT_MS,
  SCALEWAY_TEM_URL,
  ScalewayMailTransport,
  type ScalewayMailConfig,
} from 'src/mail/scaleway-mail.transport';

const RECIPIENT = 'destinataire@example.test';
const UNSUBSCRIBE_URL = 'https://app.example.test/desabonnement/jeton-123';

/**
 * A word that exists nowhere but in the body of the message: whatever a failure
 * puts into an error or a log, it must not contain this one.
 */
const BODY_SECRET = 'confidentielle';

const CONFIG: ScalewayMailConfig = {
  secretKey: 'scw-secret-key',
  projectId: '11111111-2222-3333-4444-555555555555',
};

const MESSAGE: MailMessage = {
  from: { name: 'Mon Sinistre', email: 'no-reply@example.test' },
  to: RECIPIENT,
  subject: 'Votre commune est concernée',
  text: `Bonjour,\n\nUne phrase ${BODY_SECRET} du corps du message.\n\nNe plus recevoir de messages : ${UNSUBSCRIBE_URL}`,
  html: `<html lang="fr"><body><p>Une phrase ${BODY_SECRET} du corps du message.</p><a href="${UNSUBSCRIBE_URL}">Ne plus recevoir de messages</a></body></html>`,
  headers: {
    'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
};

/** What the provider answers to a message it has taken in charge. */
const ACCEPTED = {
  emails: [{ id: '4d3e2f1a-0000-4000-8000-abcdefabcdef', status: 'new' }],
};

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit]>;

const respondingWith = (body: unknown, status = 200): FetchMock =>
  jest.fn<Promise<Response>, [string, RequestInit]>(() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

const failingWith = (error: Error): FetchMock =>
  jest.fn<Promise<Response>, [string, RequestInit]>(() =>
    Promise.reject(error),
  );

/**
 * What fetch rejects with once AbortSignal.timeout fires — reproduced rather
 * than waited for: the transport must treat it as a failure, and a test has no
 * business spending ten seconds proving it.
 */
const timeoutError = (): Error =>
  new DOMException('The operation was aborted due to timeout', 'TimeoutError');

const requestOf = (fetchFn: FetchMock): { url: string; init: RequestInit } => {
  const [url, init] = fetchFn.mock.calls[0] ?? ['', {}];
  return { url, init };
};

const payloadOf = (fetchFn: FetchMock): Record<string, unknown> => {
  const { body } = requestOf(fetchFn).init;
  // A body that is not a string is a body no JSON API was sent: fail here
  // rather than assert against "[object Object]".
  expect(typeof body).toBe('string');
  return JSON.parse(body as string) as Record<string, unknown>;
};

/** Every key of the payload, nested ones included. */
const keysOf = (value: unknown): string[] =>
  typeof value !== 'object' || value === null
    ? []
    : Object.entries(value).flatMap(([key, nested]) => [
        ...(Array.isArray(value) ? [] : [key]),
        ...keysOf(nested),
      ]);

const headerOf = (init: RequestInit, name: string): string | undefined =>
  (init.headers as Record<string, string> | undefined)?.[name];

/** The message, the stack and every cause behind it — all a log would print. */
const reportOf = (thrown: unknown): string => {
  const lines: string[] = [];
  let error: unknown = thrown;
  while (error instanceof Error && lines.length < 5) {
    lines.push(`${error.name}: ${error.message}`, error.stack ?? '');
    error = error.cause;
  }
  return lines.join('\n');
};

const transport = (fetchFn: FetchMock): ScalewayMailTransport =>
  new ScalewayMailTransport(CONFIG, fetchFn as unknown as typeof fetch);

describe('ScalewayMailTransport', () => {
  it('posts the message to the fr-par endpoint, authenticated and with a timeout', async () => {
    const fetchFn = respondingWith(ACCEPTED);

    await transport(fetchFn).send(MESSAGE);

    const { url, init } = requestOf(fetchFn);
    // The region is part of the URL, and it is the whole of the guarantee
    // "addresses are processed in the EU" (docs/research/emails.md).
    expect(url).toBe(SCALEWAY_TEM_URL);
    expect(url).toContain('/regions/fr-par/');
    expect(init.method).toBe('POST');
    expect(headerOf(init, 'X-Auth-Token')).toBe(CONFIG.secretKey);
    expect(headerOf(init, 'Content-Type')).toBe('application/json');
    // A redirect would replay the token and the message to the host it names.
    expect(init.redirect).toBe('error');
  });

  it('gives up after the timeout instead of waiting on a silent provider', async () => {
    // The signal is watched being built rather than waited out: what matters is
    // that the request carries a deadline at all, and a test has no business
    // spending ten seconds proving it. Asserting "an AbortSignal is there"
    // would not — a signal that never fires is one too.
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const fetchFn = respondingWith(ACCEPTED);

    await transport(fetchFn).send(MESSAGE);

    expect(timeout).toHaveBeenCalledWith(SCALEWAY_TEM_TIMEOUT_MS);
    expect(requestOf(fetchFn).init.signal).toBe(timeout.mock.results[0]?.value);
    // The email leaves inside the HTTP request of a person waiting for a page.
    expect(SCALEWAY_TEM_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    timeout.mockRestore();
  });

  it('sends both bodies unchanged and asks for no tracking of any kind', async () => {
    const fetchFn = respondingWith(ACCEPTED);

    await transport(fetchFn).send(MESSAGE);

    const payload = payloadOf(fetchFn);
    expect(payload.from).toEqual({
      name: MESSAGE.from.name,
      email: MESSAGE.from.email,
    });
    expect(payload.to).toEqual([{ email: RECIPIENT }]);
    expect(payload.subject).toBe(MESSAGE.subject);
    // Byte for byte: a rewritten link in one version and not in the other is
    // exactly the drift the whole "no tracking" requirement is about.
    expect(payload.text).toBe(MESSAGE.text);
    expect(payload.html).toBe(MESSAGE.html);
    expect(payload.project_id).toBe(CONFIG.projectId);
    // TEM has no click- or open-tracking at all, which is why it was chosen:
    // there is no option to switch on by accident, and none to ask for here.
    // Every key, not only the top-level ones: an option of a provider that
    // replaced this one would most plausibly arrive nested.
    expect(keysOf(payload).join(' ')).not.toMatch(/track/i);
  });

  it('passes the unsubscribe headers as the array of key/value the API expects', async () => {
    const fetchFn = respondingWith(ACCEPTED);

    await transport(fetchFn).send(MESSAGE);

    expect(payloadOf(fetchFn).additional_headers).toEqual([
      { key: 'List-Unsubscribe', value: `<${UNSUBSCRIBE_URL}>` },
      { key: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
    ]);
  });

  it('reports an HTTP error of the provider as a delivery failure', async () => {
    const fetchFn = respondingWith({ message: 'quota exceeded' }, 429);

    await expect(transport(fetchFn).send(MESSAGE)).rejects.toThrow(
      MailDeliveryError,
    );
    await expect(transport(fetchFn).send(MESSAGE)).rejects.toThrow('429');
  });

  it('reports a timeout as a delivery failure, not as a send', async () => {
    const fetchFn = failingWith(timeoutError());

    await expect(transport(fetchFn).send(MESSAGE)).rejects.toThrow(
      MailDeliveryError,
    );
  });

  it('reports a network failure as a delivery failure', async () => {
    const fetchFn = failingWith(new TypeError('fetch failed'));

    await expect(transport(fetchFn).send(MESSAGE)).rejects.toThrow(
      MailDeliveryError,
    );
  });

  it('keeps the reason of an unreachable provider in the chain of causes', async () => {
    // Otherwise the log of a failed send reads "Scaleway TEM could not be
    // reached" and never says whether it was a timeout or a refused connection.
    const fetchFn = failingWith(timeoutError());

    await expect(transport(fetchFn).send(MESSAGE)).rejects.toMatchObject({
      cause: { name: 'TimeoutError' },
    });
  });

  it('refuses an answer that is not JSON at all, however successful its status', async () => {
    // HTTP 200 and a captive portal, a proxy error page or a gateway notice in
    // the body: taking that for an accepted message loses the email quietly.
    const fetchFn = respondingWith('<html><body>Gateway</body></html>');

    await expect(transport(fetchFn).send(MESSAGE)).rejects.toThrow(
      MailDeliveryError,
    );
  });

  it('reports a provider that stalls mid-body as unreachable, not as bad JSON', async () => {
    // The same signal aborts the reading of the body, so a provider that sends
    // its headers and then goes quiet fails here. Calling that "not valid JSON"
    // would leave an operator unable to tell it from a proxy page.
    const stalled = {
      ok: true,
      status: 200,
      json: () => Promise.reject(timeoutError()),
    } as unknown as Response;
    const fetchFn = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(stalled),
    );

    const failure = await transport(fetchFn)
      .send(MESSAGE)
      .then(
        () => new Error('the send was expected to fail'),
        (thrown: unknown) => thrown,
      );

    expect(failure).toBeInstanceOf(MailDeliveryError);
    expect(reportOf(failure)).not.toMatch(/JSON/);
    expect(reportOf(failure)).toContain('TimeoutError');
  });

  it('accepts an answer that says nothing about "emails"', async () => {
    // Deliberate leniency: the shape of a successful answer is not verified
    // against the live service, and refusing here would report messages that
    // did leave as failures. Documented in docs/decisions.md — a stricter
    // check would have to change that record first.
    const fetchFn = respondingWith({});

    await expect(transport(fetchFn).send(MESSAGE)).resolves.toBeUndefined();
  });

  it('refuses an answer that is JSON but not an object', async () => {
    const fetchFn = respondingWith('"ok"');

    await expect(transport(fetchFn).send(MESSAGE)).rejects.toThrow(
      MailDeliveryError,
    );
  });

  it('refuses an answer in which the provider queued nothing', async () => {
    const fetchFn = respondingWith({ emails: [] });

    await expect(transport(fetchFn).send(MESSAGE)).rejects.toThrow(
      MailDeliveryError,
    );
  });

  it('returns once the provider has taken the message in charge', async () => {
    const fetchFn = respondingWith(ACCEPTED);

    await expect(transport(fetchFn).send(MESSAGE)).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an HTTP error', () => respondingWith({ to: RECIPIENT }, 500)],
    ['a timeout', () => failingWith(timeoutError())],
    ['an invalid answer', () => respondingWith(`{"to":"${RECIPIENT}"`)],
  ])(
    'names neither the recipient nor the body when it reports %s',
    async (_case, fetchOf) => {
      // The answer of the provider carries the recipient in its "to" field, so
      // it never goes into an error whole: the text of the error reaches the
      // logs and, later, whatever collects them.
      const failure = await transport(fetchOf())
        .send(MESSAGE)
        .then(
          () => new Error('the send was expected to fail'),
          (thrown: unknown) => thrown,
        );

      const report = reportOf(failure).toLowerCase();
      expect(report).not.toContain(RECIPIENT);
      expect(report).not.toContain('destinataire');
      expect(report).not.toContain(BODY_SECRET);
    },
  );
});

/**
 * The transport does not log: MailService logs the failure once, and it is the
 * only place that can strip an address a transport let slip. This is that
 * guarantee measured on the real client rather than on a stub of it — the
 * criterion of the issue is about what reaches the log, not about who writes it.
 */
describe('a failure of ScalewayMailTransport in the log of MailService', () => {
  const FRONTEND_URL = 'https://app.example.test';
  const configStub = {
    get: (key: string): string | undefined =>
      ({ FRONTEND_URL, MAIL_FROM: 'no-reply@example.test' })[key],
  } as unknown as ConfigService;

  const logs = captureLogs();

  it('is written at the error level, without the address and without the body', async () => {
    const service = new MailService(
      new MailComposer(configStub),
      transport(respondingWith({ to: RECIPIENT }, 503)),
    );

    await expect(
      service.send({
        to: RECIPIENT,
        subject: 'Votre commune est concernée',
        reason: 'vous suivez la commune de Nîmes',
        unsubscribePath: '/desabonnement/jeton-123',
        blocks: [
          { kind: 'paragraph', text: `Une phrase ${BODY_SECRET} du corps.` },
        ],
      }),
    ).rejects.toThrow(MailDeliveryError);

    expect(logs.levels()).toEqual(['error']);
    // The failure is named at all — otherwise the assertions below would pass
    // on an empty log for the wrong reason.
    expect(logs.text()).toContain('503');
    logs.expectNoTraceOf(RECIPIENT, BODY_SECRET);
  });
});
