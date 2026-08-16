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
export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  return NextResponse.redirect(
    new URL(
      `/veille/desinscription/confirmer?token=${encodeURIComponent(token)}`,
      request.url,
    ),
  );
}
