import type { Route } from 'next';
import { expect, type Page } from '@playwright/test';

// The status is asserted because a mistyped path would render the not-found
// page — landmark- and likely axe-clean, so a suite pointed at it would stay
// green without testing the page it claims to.
export const home = { path: '/' satisfies Route, status: 200 } as const;
// The not-found page has no route of its own — it is reached through an
// address that must not exist, hence the one path outside typedRoutes.
export const notFound = { path: '/adresse-inexistante', status: 404 } as const;

export const pages = [home, notFound] as const;

export async function gotoPage(
  page: Page,
  { path, status }: (typeof pages)[number],
) {
  const response = await page.goto(path);
  expect(response?.status()).toBe(status);
}
