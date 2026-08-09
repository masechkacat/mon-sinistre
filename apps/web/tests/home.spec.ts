import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { gotoPage, home } from './pages';
import { stringLeaves } from './strings';

test('home: exactly one h1, section headings in order', async ({ page }) => {
  await gotoPage(page, home);
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

test('home: every string from the dictionary is visible', async ({ page }) => {
  await gotoPage(page, home);
  for (const text of stringLeaves(fr.home)) {
    await expect(page.getByText(text)).toBeVisible();
  }
});

test('home: the next steps are an ordered list', async ({ page }) => {
  await gotoPage(page, home);
  const steps = page.locator('ol > li');
  await expect(steps).toHaveText([...fr.home.next.steps]);
});
