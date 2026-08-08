import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { gotoOk } from './pages';

test('home: exactly one h1, section headings in order', async ({ page }) => {
  await gotoOk(page, '/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    fr.home.title,
  );
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    fr.home.catnat.heading,
    fr.home.does.heading,
    fr.home.doesNot.heading,
    fr.home.next.heading,
  ]);
});

// Walks the dictionary instead of listing keys so that a string added to
// fr.home but forgotten on the page fails without editing this test.
function stringLeaves(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node && typeof node === 'object')
    return Object.values(node).flatMap(stringLeaves);
  return [];
}

test('home: every string from the dictionary is visible', async ({ page }) => {
  await gotoOk(page, '/');
  for (const text of stringLeaves(fr.home)) {
    await expect(page.getByText(text)).toBeVisible();
  }
});

test('home: the next steps are an ordered list', async ({ page }) => {
  await gotoOk(page, '/');
  const steps = page.locator('ol > li');
  await expect(steps).toHaveText([...fr.home.next.steps]);
});
