import { expect, type Page, type Route } from '@playwright/test';
import type { Commune } from '@mon-sinistre/contracts';
import { fr } from '../../src/i18n/fr';

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

export async function selectNimes(page: Page) {
  const input = page.getByLabel(fr.veille.form.communesLabel);
  await input.focus();
  await page.keyboard.type('Nimes');
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}
