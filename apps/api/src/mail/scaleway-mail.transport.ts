import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { MailMessage } from 'src/mail/mail-message';
import type { MailTransport } from 'src/mail/mail-transport';

/**
 * Region and API version live in this one constant: TEM answers on fr-par (and
 * on nl-ams, also in the EU), and the version is a literal in the path, so
 * moving either is a one-line change with nothing to search for.
 */
export const SCALEWAY_TEM_REGION = 'fr-par';

export const SCALEWAY_TEM_URL = `https://api.scaleway.com/transactional-email/v1alpha1/regions/${SCALEWAY_TEM_REGION}/emails`;

/**
 * Ten seconds, not the sixty of the COG import: an email leaves inside the HTTP
 * request of a person waiting for a page (the confirmation of a veille
 * subscription), and a minute of waiting is a minute of a blank screen for
 * somebody who has just been through a disaster.
 */
export const SCALEWAY_TEM_TIMEOUT_MS = 10_000;

/** Credentials only: the URL is the constant above, not a setting. */
export interface ScalewayMailConfig {
  readonly secretKey: string;
  readonly projectId: string;
}

export type FetchFn = typeof globalThis.fetch;

/**
 * The transport that actually sends: Scaleway Transactional Email, region
 * fr-par, HTTP API v1alpha1 (docs/research/emails.md).
 *
 * Two of its properties are the reason it was chosen, and both are structural
 * rather than configured:
 *
 * - **addresses are processed in the EU** — the region is part of the URL above,
 *   and the provider states that no personal data of the service leaves the
 *   Union (source and date in the research report, and in docs/decisions.md);
 * - **there is no link rewriting to switch off** — TEM has neither click- nor
 *   open-tracking, so the two versions of a body cannot drift apart after
 *   sending and no recipient address ends up in somebody else's analytics. A
 *   setting can be turned on by mistake; a feature that does not exist cannot.
 */
export class ScalewayMailTransport implements MailTransport {
  /**
   * fetchFn is injectable so tests mock HTTP without nock or msw — the same
   * shape as GeoApiClient, and the reason the module needs no dependency for
   * sending at all.
   *
   * Nothing is logged here: MailService logs a failed send once, and it is the
   * only place that can strip a recipient address a transport let slip
   * (docs/decisions.md, 03.08.2026).
   */
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
        // A redirect would replay the auth token and the whole message to
        // whatever host it names, and the answer of that host would then be
        // validated as an ordinary success — the region in the URL is exactly
        // the guarantee that would break.
        redirect: 'error',
      });
    } catch (cause) {
      // A timeout and a refused connection arrive here alike; which of the two
      // it was stays in the cause, where the log of MailService prints it.
      throw new MailDeliveryError('Scaleway TEM could not be reached', {
        cause: reportableCause(cause),
      });
    }

    if (!response.ok) {
      // The status, and the reason the provider gave for it — by an allowlist
      // of fields, never the body whole: that body names the recipient in "to",
      // and this text reaches the logs.
      const reason = await reasonOf(response);
      throw new MailDeliveryError(
        `Scaleway TEM responded with HTTP ${response.status}` +
          (reason === undefined ? '' : ` (${reason})`),
      );
    }

    await assertAccepted(response);
  }
}

/** The body of the request, in the shape the API documents. */
const payloadOf = (
  message: MailMessage,
  projectId: string,
): Record<string, unknown> => ({
  from: { name: message.from.name, email: message.from.email },
  // One message per address, always: subscribers of a commune must not see one
  // another, and the provider bills every recipient as a separate email anyway.
  to: [{ email: message.to }],
  subject: message.subject,
  // Both bodies as the skeleton rendered them. Nothing is rewritten on the way
  // out, and nobody rewrites them on the way in either — see the class comment.
  text: message.text,
  html: message.html,
  project_id: projectId,
  // An array of { key, value }, not a dictionary — this is where
  // List-Unsubscribe and its one-click companion travel.
  additional_headers: Object.entries(message.headers).map(([key, value]) => ({
    key,
    value,
  })),
});

/**
 * The fields of a failed answer that are read at all — enumerated, never
 * "everything except `to`": a field the provider adds tomorrow arrives unknown,
 * and a deny-list hands it to the logs by default.
 *
 * `type` is the error code of the Scaleway API — the one field that tells an
 * operator which failure a status covers (docs/decisions.md, 03.08.2026).
 */
const REPORTABLE_ERROR_FIELDS = ['type'] as const;

/**
 * The shape a reported value must have to be reported: a short code, the way an
 * API writes them. An address cannot pass it — an address has an `@` — so a
 * provider that one day answers `{"type": "no mailbox for x@y.test"}` loses the
 * reason instead of leaking the recipient. Allowlisting a field is a bet on
 * what the provider puts in it, and this is the bet made explicit.
 */
const ERROR_CODE = /^[a-z0-9_.-]{1,64}$/i;

/**
 * The size a failed answer may *announce* and still be read. An error of this
 * API is a few hundred bytes; anything of another order is not one, and a
 * failing send reads it once per recipient — a mailing that hits a quota wall
 * would buffer it as many times.
 *
 * A declared size, not a measured one: an answer that sends no Content-Length
 * is read whole, however long it turns out to be. A real bound lives in reading
 * response.body with a counter, and is not what this is.
 */
const MAX_ANNOUNCED_ERROR_BODY_BYTES = 16_384;

/**
 * Whether the answer is worth reading at all. A proxy page, a captive portal
 * and a gateway notice announce themselves as HTML, and a body that announces
 * another order of magnitude is not an error of this API whatever it says: in
 * both cases there is nothing on the allowlist to find, and the status alone is
 * the report.
 *
 * The two refusals are not equally firm. The content type is stated by every
 * answer, so the first one holds; the length is missing from a chunked answer,
 * and a chunked answer calling itself JSON passes here on size. TEM declares
 * the length, and the type is what keeps a stranger's page out — the gap costs
 * the memory of one request, never an address in a log (docs/decisions.md,
 * 03.08.2026).
 */
const looksLikeAnApiError = (response: Response): boolean => {
  const type = response.headers.get('content-type') ?? '';
  // Absent means "nothing announced", not "nothing to read": the check below
  // then passes on size. A malformed value is NaN and fails every comparison,
  // which refuses the body — the safe direction of the two.
  const announced = Number(response.headers.get('content-length') ?? '0');
  return (
    type.toLowerCase().includes('application/json') &&
    announced <= MAX_ANNOUNCED_ERROR_BODY_BYTES
  );
};

/**
 * Why the provider refused, in as many words as it is safe to repeat. Undefined
 * whenever the answer does not carry a code we recognise: a body that is not
 * JSON, not an object, or has nothing on the allowlist. The status is then all
 * the report carries, which is what phase 2 already gave — reading the body may
 * add a reason, never take the failure away.
 *
 * A body that is not read is dropped explicitly rather than left to the garbage
 * collector, which would hold the connection open until it got there.
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
    // A truncated body, or a provider that sent its headers and went quiet.
    // Nothing of it is reported: the text of a parse error quotes the answer,
    // and the answer names the recipient. Cancelling what is left of the body
    // is a no-op once it has been read to the end, and frees the connection of
    // a read that stopped halfway.
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
 * A 2xx is not by itself proof that the message was taken in charge: a captive
 * portal, a proxy error page or a gateway notice answers 200 with an HTML body,
 * and reading that as an accepted email loses it without a word — the one
 * failure the whole mail module exists to make impossible.
 *
 * What is checked is deliberately narrow. That the answer is a JSON object is
 * true of any answer of this API; that a queued message shows up in "emails" is
 * the documented shape, but it is not verified against the live service in the
 * research report, so an answer that says nothing about "emails" is accepted
 * rather than refused — being wrong here would refuse messages that did leave.
 * The manual check of phase 3 is what confirms the shape.
 */
const assertAccepted = async (response: Response): Promise<void> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    // The same signal aborts the reading of the body, so a provider that sends
    // its headers and then stalls fails here and not above. Reporting that as
    // malformed JSON would name a reason that is simply untrue, and an operator
    // could not tell a stalled provider from a proxy page.
    if (isAbort(cause)) {
      throw new MailDeliveryError(
        'Scaleway TEM stopped answering while its body was read',
        // The name of an abort carries nothing of the message; the text of a
        // parse error, below, quotes the answer — which names the recipient —
        // and is dropped for that reason.
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

/**
 * A timeout or an abort of the request. Recognised by name rather than by
 * class: fetch reports both as a DOMException, which is not an Error in Node.
 */
const isAbort = (thrown: unknown): boolean =>
  nameOf(thrown) === 'TimeoutError' || nameOf(thrown) === 'AbortError';

/**
 * The reason of a failure in a shape a log will print. MailService follows a
 * chain of causes only while its links are Errors — a DOMException is not one,
 * so a timeout would leave the log saying "could not be reached" and nothing
 * about why. Only the name of the thrown value is carried over: it names a
 * failure, never a message or an address.
 */
const reportableCause = (thrown: unknown): Error => {
  if (thrown instanceof Error) {
    return thrown;
  }
  const name = nameOf(thrown) ?? 'a value that is not an Error was thrown';
  return Object.assign(new Error(name), { name });
};

/**
 * Frees the connection of an answer whose body must not be read: an unread and
 * uncancelled body holds it until the garbage collector gets there.
 */
const discard = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to report: the send has already failed, and that failure is the
    // one the caller needs to hear about.
  }
};
