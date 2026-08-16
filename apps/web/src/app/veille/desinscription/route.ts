import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@/lib/api/client';
import { unsubscribeVeille } from '@/lib/api/veille';

// RFC 8058 one-click: mail clients POST here with
// `List-Unsubscribe=One-Click` and no cookie or CSRF token — the
// subscription's token travels in the query string instead, the same one
// used for the link in the email body.
// docs/research/veille-subscription-lifecycle.md, «One-click отписка».
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  try {
    await unsubscribeVeille(token);
  } catch (error) {
    // Never 200: a success the API did not confirm would tell the mail client
    // the address is off the list while it is still on it. An error leaves the
    // reader the link in the message body, which lands on the confirm page.
    // Logged because nothing else sees this failure — no screen, no user to
    // report it; the token stays out, it authorises the deletion.
    console.error(
      'veille one-click unsubscribe failed',
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
// the address of its own socket and trusts neither Host nor X-Forwarded-Host,
// so behind a proxy the absolute form sends the reader of the email to
// localhost. A rooted Location resolves against whatever host the reader
// actually came in on (RFC 7231 § 7.1.2).
export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: `/veille/desinscription/confirmer?token=${encodeURIComponent(token)}`,
    },
  });
}
