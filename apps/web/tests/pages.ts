import type { Route } from 'next';
import { expect, type Page } from '@playwright/test';
import { legalPages } from '../src/lib/legal-pages';

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
// Derived from the registry the footer renders, so a legal page cannot be
// covered by the shared suites while missing from the site, or vice versa.
const legalEntries = legalPages.map(
  ({ path }) => ({ path, status: 200 }) as const,
);

export const pages = [home, notFound, serverError, ...legalEntries] as const;

export async function gotoPage(
  page: Page,
  { path, status }: (typeof pages)[number],
) {
  const response = await page.goto(path);
  expect(response?.status()).toBe(status);
  // The error page's UI exists only after hydration (the SSR payload of a
  // failed render carries no error screen), so a suite that does not
  // auto-wait — the keyboard pass — would probe a document with nothing
  // focusable yet. Every page has exactly one h1 (layout.spec asserts it);
  // its visibility marks the page as actually rendered.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
