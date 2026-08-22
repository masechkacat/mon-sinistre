import { NextResponse } from 'next/server';

// Target of ACCOUNT_MAIL_UNSUBSCRIBE_PATH (contracts): the List-Unsubscribe
// of transactional account mails, which no subscription stands behind. The
// RFC 8058 one-click POST from a mail client is answered with an empty 200 —
// there is nothing to cancel and nothing to tell the API; a human opening the
// footer link is sent to the home page instead of a blank response.
// Rooted Location for the same reason as src/app/veille/desinscription/route.ts.
export function POST() {
  return new NextResponse(null, { status: 200 });
}

export function GET() {
  return new NextResponse(null, { status: 307, headers: { Location: '/' } });
}
