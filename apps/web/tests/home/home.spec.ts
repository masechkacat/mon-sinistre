import { expect, test, type Page } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { NIMES, mockCommuneSearch, selectNimes } from '../support/communes';
import { dossierTitle } from '../../src/lib/dossier-title';
import {
  apercuFixture,
  communeArreteFixture,
  mockApercu,
  mockCommuneArretes,
} from '../support/dossier';
import { testApiBaseUrl } from '../support/env';
import { gotoPage, home } from '../support/pages';
import { stringLeaves } from '../support/strings';

const field = (page: Page) => page.getByLabel(fr.home.communeLabel);

/** The commune answers the page asked for, collected as it asks for them. */
function arretesDemandes(page: Page) {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(`${testApiBaseUrl}/dossier/arretes`))
      urls.push(request.url());
  });
  return urls;
}

test('home: exactly one h1, section headings in order', async ({ page }) => {
  await gotoPage(page, home);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    fr.home.title,
  );
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    fr.home.catnat.heading,
    fr.home.does.heading,
    fr.home.doesNot.heading,
  ]);
});

test('home: every string from the dictionary is visible', async ({ page }) => {
  await gotoPage(page, home);
  for (const text of stringLeaves(fr.home)) {
    await expect(page.getByText(text)).toBeVisible();
  }
});

test('home: the commune field asks nothing of the API before a choice', async ({
  page,
}) => {
  const demandes = arretesDemandes(page);
  await gotoPage(page, home);

  await expect(field(page)).toBeVisible();
  // The answer block is on screen but silent: its live region has to exist
  // before it has an answer to announce.
  await expect(
    page.getByTestId('commune-arretes').getByRole('status'),
  ).toBeEmpty();
  expect(demandes).toEqual([]);
});

test('home: choosing a commune asks for its arrêtés and answers under the field', async ({
  page,
}) => {
  const demandes = arretesDemandes(page);
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await mockCommuneArretes(page, [communeArreteFixture()]);
  await gotoPage(page, home);

  await selectNimes(page, fr.home.communeLabel);

  await expect(page.getByTestId('commune-arretes')).toContainText(
    fr.communeAnswer.found(1, NIMES.name),
  );
  expect(demandes).toHaveLength(1);
  expect(new URL(demandes[0]).searchParams.get('codeInsee')).toBe(
    NIMES.codeInsee,
  );
  // The explaining copy keeps its place under the answer.
  await expect(
    page.getByRole('heading', { name: fr.home.catnat.heading }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test('home: the dossier of an arrêté opens from the answer, with no address typed', async ({
  page,
}) => {
  const apercu = apercuFixture();
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await mockCommuneArretes(page, [communeArreteFixture()]);
  await mockApercu(page, apercu);
  await gotoPage(page, home);

  await selectNimes(page, fr.home.communeLabel);
  await page.getByRole('link', { name: fr.communeAnswer.open }).click();

  // Which parameters the button carries is commune-answer.spec's business;
  // here it is the way in from the home page that is under test.
  await expect(page).toHaveURL(
    new RegExp(`/dossier\\?.*commune=${NIMES.codeInsee}`),
  );
  await expect(
    page.getByRole('heading', { level: 1, name: dossierTitle(apercu) }),
  ).toBeVisible();
});
