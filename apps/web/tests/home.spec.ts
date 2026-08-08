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

test('home: every paragraph and list item from the dictionary is visible', async ({
  page,
}) => {
  await gotoOk(page, '/');
  const texts = [
    fr.home.lead,
    fr.home.catnat.event,
    fr.home.catnat.arrete,
    fr.home.catnat.deadline,
    ...fr.home.does.items,
    ...fr.home.doesNot.items,
    ...fr.home.next.steps,
  ];
  for (const text of texts) {
    await expect(page.getByText(text)).toBeVisible();
  }
});

test('home: the next steps are an ordered list', async ({ page }) => {
  await gotoOk(page, '/');
  const steps = page.locator('ol > li');
  await expect(steps).toHaveText([...fr.home.next.steps]);
});
