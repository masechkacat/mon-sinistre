import { expect, test } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { gotoPage, serverError } from '../support/pages';

// Axe in both themes, landmarks, the keyboard pass and reflow come from the
// shared suites iterating `pages` — only the content is asserted here. The
// h1 text distinguishes our error page from the framework's built-in one;
// the 500 status itself is asserted by gotoPage. global-error.tsx stays
// without e2e (docs/research/web-foundation.md): it renders the same
// ErrorScreen this test covers through error.tsx.
test('a render error shows the French server-error page', async ({ page }) => {
  await gotoPage(page, serverError);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    fr.serverError.title,
  );
  await expect(page.getByText(fr.serverError.description)).toBeVisible();
  await expect(page.getByText(fr.serverError.digestLabel)).toBeVisible();
});

test('the server-error page offers a retry', async ({ page }) => {
  await gotoPage(page, serverError);
  await page
    .getByRole('main')
    .getByRole('button', { name: fr.serverError.retry })
    .click();
  // The re-render fails again on /test-erreur, so success is not observable;
  // what the click must not produce is a blank page.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    fr.serverError.title,
  );
});
