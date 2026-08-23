import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from '../support/a11y';
import { gotoPage, pages } from '../support/pages';

const themes = ['light', 'dark'] as const;

for (const entry of pages) {
  for (const colorScheme of themes) {
    test(`axe: ${entry.path} — theme ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await gotoPage(page, entry);
      await expectNoAxeViolations(page);
    });
  }
}

test('smoke: the check fails on an image without alt', async ({ page }) => {
  await page.setContent(
    '<!DOCTYPE html><html lang="fr"><head><title>Fumée</title></head>' +
      '<body><main><h1>Fumée</h1><img src="x.png" /></main></body></html>',
  );
  await expect(expectNoAxeViolations(page)).rejects.toThrow(/image-alt/);
});
