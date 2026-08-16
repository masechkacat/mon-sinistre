import { notFound } from 'next/navigation';

// The shared guard of the test-only routes (src/app/test-erreur,
// src/app/test-requete, src/app/test-communes): a 404 outside the Playwright
// webServer, the only place that sets TEST_ROUTES.
// `export const dynamic = 'force-dynamic'` stays
// in each page.tsx — Next.js requires a literal at the route module level, it
// cannot come from an imported function.
export function requireTestRoute() {
  if (process.env.TEST_ROUTES !== '1') notFound();
}
