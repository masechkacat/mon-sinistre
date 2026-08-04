import type { FetchFn } from 'src/common/fetch-fn';
import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { MailMessage } from 'src/mail/mail-message';
import type { MailTransport } from 'src/mail/mail-transport';

/** The region is part of the URL, not a setting: addresses stay in the EU. */
export const SCALEWAY_TEM_REGION = 'fr-par';

export const SCALEWAY_TEM_URL = `https://api.scaleway.com/transactional-email/v1alpha1/regions/${SCALEWAY_TEM_REGION}/emails`;

/** Shorter than the COG import's minute: a send happens inside a page request. */
export const SCALEWAY_TEM_TIMEOUT_MS = 10_000;

export interface ScalewayMailConfig {
  readonly secretKey: string;
  readonly projectId: string;
}

/** Nothing is logged here: logging a failed send is MailService's job. */
export class ScalewayMailTransport implements MailTransport {
  constructor(
    private readonly config: ScalewayMailConfig,
    private readonly fetchFn: FetchFn = globalThis.fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(SCALEWAY_TEM_URL, {
        method: 'POST',
        headers: {
          'X-Auth-Token': this.config.secretKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloadOf(message, this.config.projectId)),
        signal: AbortSignal.timeout(SCALEWAY_TEM_TIMEOUT_MS),
        // A redirect would replay the token and the whole message to the host in
        // Location, and its answer would validate as an ordinary success — the
        // region in the URL is exactly the guarantee that would break.
        redirect: 'error',
      });
    } catch (cause) {
      throw new MailDeliveryError('Scaleway TEM could not be reached', {
        cause: reportableCause(cause),
      });
    }

    if (!response.ok) {
      const reason = await reasonOf(response);
      throw new MailDeliveryError(
        `Scaleway TEM responded with HTTP ${response.status}` +
          (reason === undefined ? '' : ` (${reason})`),
      );
    }

    await assertAccepted(response);
  }
}

const payloadOf = (
  message: MailMessage,
  projectId: string,
): Record<string, unknown> => ({
  from: { name: message.from.name, email: message.from.email },
  // One message per address, always: subscribers of a commune must not see one
  // another.
  to: [{ email: message.to }],
  subject: message.subject,
  text: message.text,
  html: message.html,
  project_id: projectId,
  // An array of { key, value }, not a dictionary.
  additional_headers: Object.entries(message.headers).map(([key, value]) => ({
    key,
    value,
  })),
});

/**
 * Enumerated, never "everything except `to`": a field the provider adds tomorrow
 * arrives unknown, and a deny-list hands it to the logs by default.
 */
const REPORTABLE_ERROR_FIELDS = ['type'] as const;

/**
 * An address cannot pass this shape — an address has an `@` — so a provider that
 * one day answers `{"type": "no mailbox for x@y.test"}` loses the reason instead
 * of leaking the recipient.
 */
const ERROR_CODE = /^[a-z0-9_.-]{1,64}$/i;

/**
 * The size a failed answer may *announce* and still be read. A declared size,
 * not a measured one: an answer that sends no Content-Length is read whole,
 * however long it turns out to be. There is no real byte bound here.
 */
const MAX_ANNOUNCED_ERROR_BODY_BYTES = 16_384;

const looksLikeAnApiError = (response: Response): boolean => {
  const type = response.headers.get('content-type') ?? '';
  // Absent means "nothing announced", so the check then passes on size. A
  // malformed value is NaN and fails every comparison, refusing the body.
  const announced = Number(response.headers.get('content-length') ?? '0');
  return (
    type.toLowerCase().includes('application/json') &&
    announced <= MAX_ANNOUNCED_ERROR_BODY_BYTES
  );
};

/**
 * Why the provider refused, in as many words as it is safe to repeat. Reading
 * the body may add a reason, never take the failure away.
 */
const reasonOf = async (response: Response): Promise<string | undefined> => {
  if (!looksLikeAnApiError(response)) {
    await discard(response);
    return undefined;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Nothing of a parse failure is reported: its text quotes the answer, and
    // the answer names the recipient.
    await discard(response);
    return undefined;
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }

  const reported = REPORTABLE_ERROR_FIELDS.map(
    (field) => (body as Record<string, unknown>)[field],
  ).filter(
    (value): value is string =>
      typeof value === 'string' && ERROR_CODE.test(value),
  );

  return reported.length === 0 ? undefined : reported.join(', ');
};

/**
 * A 2xx is not by itself proof the message was taken in charge: a captive portal
 * or a proxy error page answers 200 with HTML, and reading that as an accepted
 * email loses it without a word.
 *
 * Deliberately narrow: an answer that says nothing about "emails" is accepted
 * rather than refused — being wrong here would refuse messages that did leave.
 */
const assertAccepted = async (response: Response): Promise<void> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    // The same signal aborts reading the body, so a provider that sends headers
    // and then stalls fails here. Calling that malformed JSON would be untrue.
    if (isAbort(cause)) {
      throw new MailDeliveryError(
        'Scaleway TEM stopped answering while its body was read',
        { cause: reportableCause(cause) },
      );
    }
    throw new MailDeliveryError(
      'Scaleway TEM answered with a body that is not valid JSON',
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MailDeliveryError(
      'Scaleway TEM answered with a body that is not a JSON object',
    );
  }

  const queued = (body as { emails?: unknown }).emails;
  if (Array.isArray(queued) && queued.length === 0) {
    throw new MailDeliveryError(
      'Scaleway TEM queued no email for this message',
    );
  }
};

const nameOf = (thrown: unknown): string | undefined => {
  const name = (thrown as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' ? name : undefined;
};

/** By name, not by class: fetch reports both as a DOMException, not an Error. */
const isAbort = (thrown: unknown): boolean =>
  nameOf(thrown) === 'TimeoutError' || nameOf(thrown) === 'AbortError';

/**
 * MailService follows a chain of causes only while its links are Errors, and a
 * DOMException is not one — without this a timeout would log "could not be
 * reached" and nothing about why. Only the name is carried over.
 */
const reportableCause = (thrown: unknown): Error => {
  if (thrown instanceof Error) {
    return thrown;
  }
  const name = nameOf(thrown) ?? 'a value that is not an Error was thrown';
  return Object.assign(new Error(name), { name });
};

/** An unread and uncancelled body holds the connection until the GC gets there. */
const discard = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // The send has already failed; that failure is the one the caller needs.
  }
};
