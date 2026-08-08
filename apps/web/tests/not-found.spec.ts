import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { gotoPage, notFound } from './pages';

// Axe in both themes, landmarks, the keyboard pass and reflow come from the
// shared suites iterating `pages` — only the content is asserted here. The
// h1 text distinguishes our page from the framework's built-in one (its
// heading is "404"); the 404 status itself is asserted by gotoPage.
test('a nonexistent address shows the French not-found page', async ({
  page,
}) => {
  await gotoPage(page, notFound);
  await expect(page).toHaveTitle(fr.notFound.title);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    fr.notFound.title,
  );
  await expect(page.getByText(fr.notFound.description)).toBeVisible();
});

test('the not-found page links back to the home page', async ({ page }) => {
  await gotoPage(page, notFound);
  const backLink = page
    .getByRole('main')
    .getByRole('link', { name: fr.notFound.backHome });
  await expect(backLink).toHaveAttribute('href', '/');
});
