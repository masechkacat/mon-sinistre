import { NextResponse, type NextRequest } from 'next/server';
import { unsubscribeVeille } from '@/lib/api/veille';

// RFC 8058 one-click: mail clients POST here with
// `List-Unsubscribe=One-Click` and no cookie or CSRF token — the
// subscription's token travels in the query string instead, the same one
// used for the link in the email body.
// docs/research/veille-subscription-lifecycle.md, «One-click отписка».
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  await unsubscribeVeille(token);
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
