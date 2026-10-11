import { expect, test, type Page } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { LOGIN_NEXT_PARAM } from '../../src/lib/api/session';
import { dossierSearch } from '../../src/lib/dossier-params';
import { LOGIN_EMAIL, fillLoginForm, mockLogin } from '../support/connexion';
import {
  APERCU_PARAMS,
  AUTRE_DATE_EVENEMENT,
  DOSSIER_PATH,
  apercuFixture,
  mockApercu,
} from '../support/dossier';
import { VALID_PASSWORD } from '../support/form';
import {
  SINISTRE_ID_1,
  SINISTRE_ID_2,
  conflictReply,
  createdReply,
  mockCreateSinistre,
} from '../support/sinistres';

/** The login a visitor reaches from the dossier they prepared without an account. */
const CONNEXION_DOSSIER_PATH = `/connexion${dossierSearch(APERCU_PARAMS)}`;

/** The address the confirmation page builds once the dossier is already saved. */
const CONNEXION_SUIVANT_PATH = `/connexion?${LOGIN_NEXT_PARAM}=/sinistres/${SINISTRE_ID_1}`;

async function login(page: Page, path: string) {
  await page.goto(path);
  await fillLoginForm(page, { email: LOGIN_EMAIL, password: VALID_PASSWORD });
}

test('logging in from a dossier address saves that dossier and opens it', async ({
  page,
}) => {
  await mockLogin(page);
  const sent = await mockCreateSinistre(page, [
    createdReply(SINISTRE_ID_1, 201),
  ]);

  await login(page, CONNEXION_DOSSIER_PATH);

  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID_1}`);
  expect(sent).toEqual([
    {
      codeInsee: APERCU_PARAMS.commune,
      risque: APERCU_PARAMS.risque,
      eventDate: APERCU_PARAMS.date,
    },
  ]);
});

test('a dossier already open for the commune is asked about instead of being doubled', async ({
  page,
}) => {
  await mockLogin(page);
  await mockCreateSinistre(page, [
    conflictReply(SINISTRE_ID_2, AUTRE_DATE_EVENEMENT),
  ]);

  await login(page, CONNEXION_DOSSIER_PATH);

  await expect(
    page.getByRole('link', { name: fr.sinistres.doublon.ouvrir }),
  ).toHaveAttribute('href', `/sinistres/${SINISTRE_ID_2}`);
});

test('`suivant` takes the person on to the page the link asked for', async ({
  page,
}) => {
  await mockLogin(page);
  const sent = await mockCreateSinistre(page, [
    createdReply(SINISTRE_ID_1, 201),
  ]);

  await login(page, CONNEXION_SUIVANT_PATH);

  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID_1}`);
  // Both ways out of the login land on the same address here, so only the
  // requests tell them apart: the dossier is already saved.
  expect(sent).toEqual([]);
});

for (const suivant of [
  '//evil.example',
  '/\\evil.example',
  '/\t/evil.example',
  '/..//evil.example',
  'https://evil.example',
]) {
  // Every one of these reaches another host: the tab is dropped by the URL
  // parser and the dot segment is resolved away, and both leave the value
  // protocol-relative.
  test(`suivant=${JSON.stringify(suivant)} is ignored, and the login lands in the personal space`, async ({
    page,
  }) => {
    await mockLogin(page);

    await login(
      page,
      `/connexion?${LOGIN_NEXT_PARAM}=${encodeURIComponent(suivant)}`,
    );

    await expect(page).toHaveURL('/espace-personnel');
  });
}

test('a save that fails after the login is retried on its own, without logging in again', async ({
  page,
}) => {
  const logins = await mockLogin(page);
  const sent = await mockCreateSinistre(page, [
    { status: 500, contentType: 'application/json', body: '{}' },
    createdReply(SINISTRE_ID_1, 201),
  ]);

  await login(page, CONNEXION_DOSSIER_PATH);

  await expect(page.getByTestId('request-error')).toBeVisible();
  await expect(page.getByLabel(fr.compte.connexion.passwordLabel)).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: fr.serverError.retry }).click();

  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID_1}`);
  expect(sent).toHaveLength(2);
  expect(logins).toHaveLength(1);
});

test('a dossier the API refuses after the login is not retried, only taken back to', async ({
  page,
}) => {
  await mockLogin(page);
  await mockCreateSinistre(page, [
    { status: 400, contentType: 'application/json', body: '{}' },
  ]);

  await login(page, CONNEXION_DOSSIER_PATH);

  await expect(
    page.getByRole('link', { name: fr.dossier.revenir }),
  ).toHaveAttribute('href', DOSSIER_PATH);
  await expect(
    page.getByRole('button', { name: fr.serverError.retry }),
  ).toHaveCount(0);
});

test('“revenir et corriger” after the login goes back to the dossier, still logged in', async ({
  page,
}) => {
  await mockLogin(page);
  await mockApercu(page, apercuFixture());
  await mockCreateSinistre(page, [
    conflictReply(SINISTRE_ID_2, AUTRE_DATE_EVENEMENT),
  ]);

  await login(page, CONNEXION_DOSSIER_PATH);
  await page
    .getByRole('button', { name: fr.sinistres.doublon.corriger })
    .click();

  await expect(page).toHaveURL(DOSSIER_PATH);
});

test('the link to the registration carries the dossier of the address', async ({
  page,
}) => {
  await page.goto(CONNEXION_DOSSIER_PATH);

  await expect(
    page.getByRole('link', { name: fr.compte.connexion.registerLink }),
  ).toHaveAttribute('href', `/inscription${dossierSearch(APERCU_PARAMS)}`);
});
