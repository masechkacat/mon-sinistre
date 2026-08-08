import { notFound } from 'next/navigation';

// force-dynamic keeps the build from freezing the outcome before the env is
// read: outside the Playwright webServer (the only place that sets
// TEST_ROUTES) the route is a 404 — docs/research/web-foundation.md,
// «Провокация ошибки рендера».
export const dynamic = 'force-dynamic';

export default function TestErreurPage() {
  if (process.env.TEST_ROUTES !== '1') notFound();
  throw new Error('Erreur de rendu provoquée pour les tests');
}
