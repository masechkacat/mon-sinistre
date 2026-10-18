import { expect, test, type Page } from '@playwright/test';
import { formatDateFr } from '../../src/i18n/date';
import { fr } from '../../src/i18n/fr';
import { communeLabel } from '../../src/lib/commune-label';
import { dossierPath } from '../../src/lib/dossier-params';
import {
  NIMES,
  holdCommuneSearch,
  mockCommuneSearch,
} from '../support/communes';
import {
  APERCU_PARAMS,
  DOSSIER_PATH,
  apercuFixture,
  mockApercu,
} from '../support/dossier';
import { testApiBaseUrl } from '../support/env';
import { VALID_PASSWORD } from '../support/form';
import { mockNoSession } from '../support/session-mock';

const EMAIL = 'sinistre@example.fr';

/** The registration a visitor reaches from « Enregistrer ce dossier ». */
const INSCRIPTION_DOSSIER_PATH = dossierPath('/inscription', APERCU_PARAMS);

const RESUME = fr.dossier.summary([
  fr.sinistres.risque.options[APERCU_PARAMS.risque].label,
  communeLabel(NIMES),
  formatDateFr(APERCU_PARAMS.date),
]);

async function openInscription(page: Page, path: string) {
  // The summary names the commune, and the address carries only its code: the
  // referential answers a code as a search.
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto(path);
}

async function register(page: Page) {
  const sent: unknown[] = [];
  await page.route(`${testApiBaseUrl}/auth/register`, (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}'));
    return route.fulfill({ status: 204 });
  });
  return sent;
}

async function submit(page: Page) {
  await page.getByLabel(fr.compte.inscription.emailLabel).fill(EMAIL);
  await page
    .getByLabel(fr.compte.inscription.passwordLabel)
    .fill(VALID_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.inscription.submit })
    .click();
  await expect(page.getByTestId('inscription-confirmation')).toBeFocused();
}

test('the registration summarises the dossier of the address and sends its three parameters', async ({
  page,
}) => {
  const sent = await register(page);
  await openInscription(page, INSCRIPTION_DOSSIER_PATH);

  await expect(page.getByTestId('dossier-summary')).toHaveText(RESUME);

  await submit(page);

  expect(sent).toEqual([
    {
      email: EMAIL,
      password: VALID_PASSWORD,
      dossier: {
        codeInsee: APERCU_PARAMS.commune,
        risque: APERCU_PARAMS.risque,
        eventDate: APERCU_PARAMS.date,
      },
    },
  ]);
});

test('without parameters the registration carries no dossier and shows no summary', async ({
  page,
}) => {
  const sent = await register(page);
  await openInscription(page, '/inscription');

  await expect(page.getByTestId('dossier-summary')).toHaveCount(0);

  await submit(page);

  expect(sent).toEqual([{ email: EMAIL, password: VALID_PASSWORD }]);
});

test('the summary is written once, when the name of the commune is known', async ({
  page,
}) => {
  const held = await holdCommuneSearch(page, APERCU_PARAMS.commune);
  await page.goto(INSCRIPTION_DOSSIER_PATH);

  // Appending the commune to a line already read would go unannounced, so
  // nothing is written until the name is there — the room for it is.
  const summary = page.getByTestId('dossier-summary');
  await expect(summary).toBeEmpty();

  held.release();

  await expect(summary).toHaveText(RESUME);
});

test('coming from the dossier, the summary names the commune without asking the referential', async ({
  page,
}) => {
  let searches = 0;
  await page.route(`${testApiBaseUrl}/communes**`, (route) => {
    searches += 1;
    return mockCommuneSearch(route);
  });
  await mockNoSession(page);
  await mockApercu(page, apercuFixture());
  await page.goto(DOSSIER_PATH);

  await page.getByRole('button', { name: fr.dossier.save }).click();

  await expect(page).toHaveURL(INSCRIPTION_DOSSIER_PATH);
  // The aperçu the person just left already named the commune.
  await expect(page.getByTestId('dossier-summary')).toHaveText(RESUME);
  expect(searches).toBe(0);
});

test('the link to the login page carries the same three parameters', async ({
  page,
}) => {
  await openInscription(page, INSCRIPTION_DOSSIER_PATH);

  await expect(
    page
      .getByRole('main')
      .getByRole('link', { name: fr.compte.inscription.loginLink }),
  ).toHaveAttribute('href', dossierPath('/connexion', APERCU_PARAMS));
});
