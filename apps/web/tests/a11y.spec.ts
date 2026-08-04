import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './a11y';
import { pages } from './pages';

const themes = ['light', 'dark'] as const;

for (const path of pages) {
  for (const colorScheme of themes) {
    test(`axe: ${path} — theme ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      const response = await page.goto(path);
      // A missing route would render Next's own 404, likely axe-clean —
      // the run would stay green without testing the page it claims to.
      expect(response?.status()).toBe(200);
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
