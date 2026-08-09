import { expect, test } from '@playwright/test';
import { legalSections } from '../src/components/legal-page';
import { fr } from '../src/i18n/fr';
import {
  gotoPage,
  home,
  mentionsLegales,
  politiqueConfidentialite,
} from './pages';
import { stringLeaves } from './strings';

// Axe in both themes, landmarks, the keyboard pass and reflow come from the
// shared suites iterating `pages` — only navigation and content live here.
const legalPages = [
  { entry: mentionsLegales, dict: fr.mentionsLegales },
  { entry: politiqueConfidentialite, dict: fr.politiqueConfidentialite },
] as const;

for (const { entry, dict } of legalPages) {
  test(`the footer link opens ${entry.path}`, async ({ page }) => {
    await gotoPage(page, home);
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: dict.title })
      .click();
    await expect(page).toHaveURL(entry.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      dict.title,
    );
  });

  // Scoped to main: the footer link of the page itself repeats the title.
  test(`every string from the dictionary is visible: ${entry.path}`, async ({
    page,
  }) => {
    await gotoPage(page, entry);
    await expect(page).toHaveTitle(dict.title);
    for (const text of stringLeaves(dict)) {
      // exact: a section heading is also a case-insensitive substring of its
      // own body text («Éditeur du site» / «l’éditeur du site»).
      await expect(
        page.getByRole('main').getByText(text, { exact: true }),
      ).toBeVisible();
    }
  });

  test(`section headings in dictionary order: ${entry.path}`, async ({
    page,
  }) => {
    await gotoPage(page, entry);
    const headings = legalSections(dict).map((section) => section.heading);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(headings);
  });
}
