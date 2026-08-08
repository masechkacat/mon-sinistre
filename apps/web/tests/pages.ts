import type { Route } from 'next';
import { expect, type Page } from '@playwright/test';

export const pages = ['/'] as const satisfies readonly Route[];

// A missing route would render Next's own 404 — landmark- and likely
// axe-clean, so a check would stay green without testing the page it
// claims to.
export async function gotoOk(page: Page, path: (typeof pages)[number]) {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
}
