import { notFound } from 'next/navigation';

// Garde commune aux routes réservées aux tests (src/app/test-erreur,
// src/app/test-requete) : 404 en dehors du webServer Playwright, seul
// endroit qui pose TEST_ROUTES. `export const dynamic = 'force-dynamic'`
// reste dans chaque page.tsx — Next.js exige un littéral au niveau du
// module de la route, il ne peut pas venir d'une fonction importée.
export function requireTestRoute() {
  if (process.env.TEST_ROUTES !== '1') notFound();
}
