import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@/lib/api/client';

interface OneClickUnsubscribeOptions {
  /** Turns the mailing off for the token of the link. */
  unsubscribe: (token: string) => Promise<void>;
  /** Page with the confirm button `GET` sends a human to, rooted. */
  confirmPath: string;
}

/**
 * The pair of handlers behind an unsubscribe link carried by a mail: one
 * `route.ts` per mailing mounts them with its own endpoint and confirm page
 * (docs/research/sinistre-reminders.md, «Web: route handler и страница через
 * общие части с veille»). Both mailings answer the same way, so the shape of
 * the answer — statuses, the `Location`, what gets logged — is decided here
 * once.
 */
export function oneClickUnsubscribeHandlers({
  unsubscribe,
  confirmPath,
}: OneClickUnsubscribeOptions) {
  // RFC 8058 one-click: mail clients POST here with
  // `List-Unsubscribe=One-Click` and no cookie or CSRF token — the
  // subscription's token travels in the query string instead, the same one
  // used for the link in the email body.
  // docs/research/veille-subscription-lifecycle.md, «One-click отписка».
  async function POST(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token') ?? '';
    try {
      await unsubscribe(token);
    } catch (error) {
      // Never 200: a success the API did not confirm would tell the mail
      // client the address is off the list while it is still on it. An error
      // leaves the reader the link in the message body, which lands on the
      // confirm page.
      // Logged because nothing else sees this failure — no screen, no user to
      // report it; the token stays out, it authorises the unsubscribe. The
      // confirm page stands in for the name of the mailing: one label fewer
      // to keep in step with the route the handlers are mounted on.
      console.error(
        `one-click unsubscribe failed (${confirmPath})`,
        error instanceof ApiError ? `API ${error.status}` : error,
      );
      return new NextResponse(null, { status: 502 });
    }
    return new NextResponse(null, { status: 200 });
  }

  // A human following the same link must not unsubscribe by merely opening
  // it — this redirects to the page with the confirm button instead.
  // The Location stays rooted instead of going through NextResponse.redirect,
  // which demands an absolute URL: self-hosted Next builds `request.url` from
  // the address of its own socket and trusts neither Host nor
  // X-Forwarded-Host, so behind a proxy the absolute form sends the reader of
  // the email to localhost. A rooted Location resolves against whatever host
  // the reader actually came in on (RFC 7231 § 7.1.2).
  function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token') ?? '';
    return new NextResponse(null, {
      status: 307,
      headers: {
        Location: `${confirmPath}?token=${encodeURIComponent(token)}`,
      },
    });
  }

  return { POST, GET };
}
