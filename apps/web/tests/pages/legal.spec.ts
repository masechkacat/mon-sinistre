import { expect, test } from '@playwright/test';
import type { LegalSection } from '../../src/components/legal-page';
import { fr } from '../../src/i18n/fr';
import { legalPages } from '../../src/lib/legal-pages';
import { gotoPage, home } from '../support/pages';
import { stringLeaves } from '../support/strings';

// Axe in both themes, landmarks, the keyboard pass and reflow come from the
// shared suites iterating `pages` — only navigation and content live here.
for (const { path, dict } of legalPages) {
  test(`the footer link opens ${path}`, async ({ page }) => {
    await gotoPage(page, home);
    await page
      .getByRole('contentinfo')
      .getByRole('navigation', { name: fr.layout.legalNav })
      .getByRole('link', { name: dict.title })
      .click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      dict.title,
    );
  });

  // Scoped to main: the footer link of the page itself repeats the title.
  test(`every string from the dictionary is visible: ${path}`, async ({
    page,
  }) => {
    await gotoPage(page, { path, status: 200 });
    await expect(page).toHaveTitle(dict.title);
    for (const text of stringLeaves(dict)) {
      // exact: a section heading is also a case-insensitive substring of its
      // own body text («Éditeur du site» / «l’éditeur du site»).
      await expect(
        page.getByRole('main').getByText(text, { exact: true }),
      ).toBeVisible();
    }
  });

  test(`section headings in dictionary order: ${path}`, async ({ page }) => {
    await gotoPage(page, { path, status: 200 });
    const headings = dict.sections.map((section) => section.heading);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(headings);
  });
}

// What the loop above cannot see: it checks that whatever the dictionary says
// reaches the page, not that the attribution CC BY requires — author, licence
// and a link to the licence text — is still in it.
test('mentions légales: the Crédits section credits the font', () => {
  const credits: LegalSection | undefined = fr.mentionsLegales.sections.find(
    (section) => section.heading === 'Crédits',
  );
  const credited = stringLeaves(credits).join(' ');
  for (const mention of ['Luciole', 'CC BY 4.0'])
    expect(credited).toContain(mention);
  expect(credits?.links?.map(({ href }) => href.href)).toContain(
    'https://creativecommons.org/licenses/by/4.0/',
  );
});

// What the loop above cannot see: the loop compares the page against the
// dictionary, not against the RGAA 4.1.2 model, whose six headings these are.
test('the accessibility declaration: model sections, recourse link outbound', async ({
  page,
}) => {
  expect(fr.accessibilite.sections.map((section) => section.heading)).toEqual([
    'État de conformité',
    'Résultats des tests',
    'Contenus non accessibles',
    'Établissement de cette déclaration',
    'Retour d’information et contact',
    'Voies de recours',
  ]);
  await gotoPage(page, { path: '/accessibilite', status: 200 });
  const recours = fr.accessibilite.sections[5];
  expect(recours.links).not.toEqual([]);
  for (const { text, href } of recours.links) {
    expect(href.hostname).toMatch(/defenseurdesdroits\.fr$/);
    await expect(
      page.getByRole('main').getByRole('link', { name: text }),
    ).toHaveAttribute('href', href.href);
  }
});
