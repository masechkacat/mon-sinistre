import type { Route } from 'next';
import { expect, type Page } from '@playwright/test';
import { legalPages } from '../src/lib/legal-pages';
import { fr } from '../src/i18n/fr';
import { testApiBaseUrl } from './env';

// The status is asserted because a mistyped path would render the not-found
// page — landmark- and likely axe-clean, so a suite pointed at it would stay
// green without testing the page it claims to.
export const home = { path: '/' satisfies Route, status: 200 } as const;
// The not-found page has no route of its own — it is reached through an
// address that must not exist, hence the one path outside typedRoutes.
export const notFound = { path: '/adresse-inexistante', status: 404 } as const;
// A real server-render error behind TEST_ROUTES (set only by the Playwright
// webServer; the route 404s in production) — docs/research/web-foundation.md,
// «Провокация ошибки рендера».
export const serverError = {
  path: '/test-erreur' satisfies Route,
  status: 500,
} as const;
export const veille = { path: '/veille' satisfies Route, status: 200 } as const;
// The token is deliberately unknown, and the status GET is mocked to a real
// domain "invalid" response: nothing listens on testApiBaseUrl during
// `npm run test:web` (env.ts), so without a mock the request would fail to
// connect and the page would show the generic RequestError screen instead of
// "lien invalide" — the branch these shared suites are meant to cover.
export const veilleConfirmation = {
  path: '/veille/confirmation?token=invalide' as Route,
  status: 200,
  // The h1 of this page is already on screen while the status GET is in
  // flight, so gotoPage's generic gate lets a suite start on the loading
  // state and race the swap. The heading below appears only with the screen
  // the mock above stands for.
  ready: (page: Page) =>
    expect(
      page.getByRole('heading', { name: fr.veille.confirmation.invalid.title }),
    ).toBeVisible(),
  mockApi: (page: Page) =>
    page.route(`${testApiBaseUrl}/veille/confirmation**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'invalid' }),
      }),
    ),
} as const;
// No mockApi: unlike the confirmation page, this one calls the API only on
// the button click, never on load — nothing to intercept for a plain visit.
export const veilleDesinscriptionConfirmer = {
  path: '/veille/desinscription/confirmer?token=invalide' as Route,
  status: 200,
} as const;
// Same rationale as veilleConfirmation above: the status GET fires on load,
// so it needs a mock to reach "lien invalide" instead of the RequestError
// screen this suite is not meant to cover.
export const veilleChange = {
  path: '/veille/changement?token=invalide' as Route,
  status: 200,
  ready: (page: Page) =>
    expect(
      page.getByRole('heading', { name: fr.veille.change.invalid.title }),
    ).toBeVisible(),
  mockApi: (page: Page) =>
    page.route(`${testApiBaseUrl}/veille/changement**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'invalid' }),
      }),
    ),
} as const;
// Derived from the registry the footer renders, so a legal page cannot be
// covered by the shared suites while missing from the site, or vice versa.
const legalEntries = legalPages.map(
  ({ path }) => ({ path, status: 200 }) as const,
);

export const pages = [
  home,
  notFound,
  serverError,
  veille,
  veilleConfirmation,
  veilleDesinscriptionConfirmer,
  veilleChange,
  ...legalEntries,
] as const;

export async function gotoPage(page: Page, entry: (typeof pages)[number]) {
  if ('mockApi' in entry) await entry.mockApi(page);
  const response = await page.goto(entry.path);
  expect(response?.status()).toBe(entry.status);
  // The error page's UI exists only after hydration (the SSR payload of a
  // failed render carries no error screen), so a suite that does not
  // auto-wait — the keyboard pass — would probe a document with nothing
  // focusable yet. Every page has exactly one h1 (layout.spec asserts it);
  // its visibility marks the page as actually rendered.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // …unless the page paints its h1 before the state under test exists.
  if ('ready' in entry) await entry.ready(page);
}
