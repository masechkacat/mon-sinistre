import { expect, type Page, type Route } from '@playwright/test';
import type { Commune } from '@mon-sinistre/contracts';
import { fr } from '../../src/i18n/fr';
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
 * timing. Shared by both combobox specs — each one asserts that a stale list
 * cannot be committed.
 */
export async function holdCommuneSearch(page: Page, heldQuery: string) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${testApiBaseUrl}/communes**`, async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (q === heldQuery) await held;
    await mockCommuneSearch(route);
  });
  return { release: () => release() };
}

export async function selectNimes(
  page: Page,
  label: string = fr.veille.form.communesLabel,
) {
  const input = page.getByLabel(label);
  await input.focus();
  await page.keyboard.type('Nimes');
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}
