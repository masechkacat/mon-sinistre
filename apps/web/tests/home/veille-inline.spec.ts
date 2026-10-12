import { expect, test, type Page } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import {
  CHATEAU,
  NIMES,
  mockCommuneSearch,
  selectCommune,
  selectNimes,
} from '../support/communes';
import { mockCommuneArretes, reponseCommunePath } from '../support/dossier';
import { testApiBaseUrl } from '../support/env';
import { expectErrorTiedTo } from '../support/form';
import { gotoPage, home } from '../support/pages';
import { mockSubscribe } from '../support/veille';

const copy = fr.veille;
const adresse = 'riverain@example.fr';

/** The answer about Nîmes, with the subscription line under it. An empty
 * answer is the case the line matters most in: the arrêté is still to come. */
async function ouvrirReponse(page: Page) {
  await mockCommuneArretes(page, []);
  await page.goto(reponseCommunePath());
  await expect(
    page.getByRole('heading', { name: copy.inline.heading(NIMES.name) }),
  ).toBeVisible();
}

const bouton = (page: Page) =>
  page.getByRole('button', { name: copy.inline.submit });
const champ = (page: Page) => page.getByLabel(copy.form.emailLabel);

test('the subscription goes out for the commune on screen, and the success screen is announced', async ({
  page,
}) => {
  const bodies = await mockSubscribe(page);
  await ouvrirReponse(page);

  await champ(page).fill(`  ${adresse}  `);
  await bouton(page).click();

  const resultat = page.getByTestId('veille-inline-confirmation');
  await expect(resultat).toBeFocused();
  await expect(resultat).toContainText(copy.confirmationSent.title);
  const annonce = page
    .getByRole('status')
    .filter({ hasText: copy.confirmationSent.title });
  await expect(annonce).toContainText(copy.confirmationSent.description);
  expect(bodies).toEqual([{ email: adresse, communeCodes: [NIMES.codeInsee] }]);
  await expectNoAxeViolations(page);
});

test('correcting the commune clears a confirmation, and keeps the address typed', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await mockCommuneArretes(page, []);
  const bodies = await mockSubscribe(page);
  await gotoPage(page, home);
  await selectNimes(page, fr.home.communeLabel);
  await champ(page).fill(adresse);
  await bouton(page).click();
  await expect(page.getByTestId('veille-inline-confirmation')).toContainText(
    copy.confirmationSent.title,
  );

  await selectCommune(page, fr.home.communeLabel, 'Chateau', /Château-Thierry/);

  await expect(
    page.getByRole('heading', { name: copy.inline.heading(CHATEAU.name) }),
  ).toBeVisible();
  await expect(page.getByText(copy.confirmationSent.title)).toHaveCount(0);
  await expect(champ(page)).toHaveValue(adresse);
  await bouton(page).click();
  expect(bodies.map((b) => (b as { communeCodes: string[] }).communeCodes)).toEqual(
    [[NIMES.codeInsee], [CHATEAU.codeInsee]],
  );
});

test('an empty address reports an error tied to the field, and does not send the request', async ({
  page,
}) => {
  const bodies = await mockSubscribe(page);
  await ouvrirReponse(page);

  await bouton(page).click();

  await expectErrorTiedTo(
    champ(page),
    page.getByText(copy.form.emailRequiredError),
  );
  expect(bodies).toEqual([]);
  await expectNoAxeViolations(page);
});

test('an invalid address reports an error tied to the field, and does not send the request', async ({
  page,
}) => {
  const bodies = await mockSubscribe(page);
  await ouvrirReponse(page);

  await champ(page).fill('pas-une-adresse');
  await bouton(page).click();

  await expectErrorTiedTo(
    champ(page),
    page.getByText(copy.form.emailInvalidError),
  );
  expect(bodies).toEqual([]);
});

test('a rate-limited subscription shows the French error message, and the form stays usable', async ({
  page,
}) => {
  await mockSubscribe(page, 429);
  await ouvrirReponse(page);

  await champ(page).fill(adresse);
  await bouton(page).click();

  const alerte = page.getByTestId('request-error');
  await expect(alerte).toHaveAttribute('role', 'alert');
  await expect(alerte).toContainText(fr.requestError.title);
  await expect(bouton(page)).toBeEnabled();
});

test('the line shows the purpose of the address and links to the privacy policy', async ({
  page,
}) => {
  await ouvrirReponse(page);

  await expect(page.getByText(copy.form.purpose)).toBeVisible();
  await expect(
    page.getByRole('link', { name: copy.form.privacyPolicyLink }),
  ).toHaveAttribute('href', '/politique-de-confidentialite');
});
