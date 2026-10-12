import { expect, type Page, type Route } from '@playwright/test';
import type { Commune } from '@mon-sinistre/contracts';
import { deferred } from './deferred';
import { testApiBaseUrl } from './env';

export const CHATEAU: Commune = {
  codeInsee: '02168',
  name: 'Château-Thierry',
  departementCode: '02',
  departementName: 'Aisne',
};
export const NIMES: Commune = {
  codeInsee: '30189',
  name: 'Nîmes',
  departementCode: '30',
  departementName: 'Gard',
};

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

// Mirrors the API's search: name prefix (accent-insensitive) or exact INSEE
// code — good enough for a mock, the real matching is tested in the API.
function communesMatching(q: string): Commune[] {
  const normalizedQuery = normalize(q);
  return [CHATEAU, NIMES].filter(
    (commune) =>
      normalize(commune.name).startsWith(normalizedQuery) ||
      commune.codeInsee.toLowerCase() === q.toLowerCase(),
  );
}

export async function mockCommuneSearch(route: Route) {
  const url = new URL(route.request().url());
  const q = url.searchParams.get('q') ?? '';
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(communesMatching(q)),
  });
}

/**
 * Installs the commune search mock with the answer to one query held back
 * until the returned `release` is called: the window in which the popup shows
 * the previous query's results is then deterministic instead of depending on
 * timing: the combobox spec asserts that a stale list cannot be committed.
 */
export async function holdCommuneSearch(page: Page, heldQuery: string) {
  const held = deferred();
  await page.route(`${testApiBaseUrl}/communes**`, async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (q === heldQuery) await held.promise;
    await mockCommuneSearch(route);
  });
  return held;
}

/** Types `typed` into the combobox under `label` and commits the option
 * `name` — over a commune already chosen as well. */
export async function selectCommune(
  page: Page,
  label: string,
  typed: string,
  name: RegExp,
) {
  await page.getByLabel(label).focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(typed);
  await expect(page.getByRole('option', { name })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

export const selectNimes = (page: Page, label: string) =>
  selectCommune(page, label, 'Nimes', /Nîmes/);
