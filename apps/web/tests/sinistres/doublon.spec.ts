import { expect, test, type Page } from '@playwright/test';
import { toIsoDate } from '@mon-sinistre/contracts';
import { formatDateFr } from '../../src/i18n/date';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { NIMES, mockCommuneSearch, selectNimes } from '../support/communes';
import { deferred } from '../support/deferred';
import { testApiBaseUrl } from '../support/env';
import { mockSession } from '../support/session-mock';
import {
  SINISTRE_ID_1,
  SINISTRE_ID_2,
  conflictReply,
  createdReply,
  mockCreateSinistre,
} from '../support/sinistres';

const EVENT_DATE = '2026-06-15';
/** The date of the dossier already open: another event, same commune and risk. */
const EXISTING_DATE = toIsoDate('2026-03-02');

const CONFLICT = conflictReply(SINISTRE_ID_1, EXISTING_DATE);

async function submitNouveau(page: Page) {
  await page.goto('/sinistres/nouveau');
  await selectNimes(page, fr.sinistres.nouveau.communeLabel);
  await page
    .getByRole('radio', { name: fr.sinistres.risque.options.INONDATION.label })
    .click();
  await page.getByLabel(fr.sinistres.nouveau.eventDateLabel).fill(EVENT_DATE);
  await page.getByRole('button', { name: fr.sinistres.nouveau.submit }).click();
}

/** Fills the form and submits it onto a 409; the next attempt gets `after`. */
async function openConflict(
  page: Page,
  after = createdReply(SINISTRE_ID_2, 201),
) {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await mockSession(page).install();
  const sent = await mockCreateSinistre(page, [CONFLICT, after]);
  await submitNouveau(page);
  await expect(page.getByTestId('dossier-existant')).toBeVisible();
  return sent;
}

test('the dossier already open is named with its date, and both ways out are offered', async ({
  page,
}) => {
  await openConflict(page);

  await expect(
    page.getByRole('heading', { name: fr.sinistres.doublon.titre, level: 1 }),
  ).toBeVisible();
  // Scoped to the screen: the same sentence is also in the live region that
  // announced it, and that copy is deliberately `sr-only`.
  await expect(
    page.getByTestId('dossier-existant').getByText(formatDateFr(EXISTING_DATE)),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: fr.sinistres.doublon.ouvrir }),
  ).toHaveAttribute('href', `/sinistres/${SINISTRE_ID_1}`);
  await expect(
    page.getByRole('button', { name: fr.sinistres.doublon.creer }),
  ).toBeVisible();
  // The question replaces the form: the answer cannot be left unread above a
  // submit button that would only ask it again.
  await expect(
    page.getByRole('button', { name: fr.sinistres.nouveau.submit }),
  ).toHaveCount(0);
});

test('“ouvrir” goes to the existing dossier without sending the request again', async ({
  page,
}) => {
  const sent = await openConflict(page);

  await page.getByRole('link', { name: fr.sinistres.doublon.ouvrir }).click();

  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID_1}`);
  expect(sent).toHaveLength(1);
});

test('“créer un second dossier” repeats the request with confirmNew and opens the new one', async ({
  page,
}) => {
  const sent = await openConflict(page);

  await page.getByRole('button', { name: fr.sinistres.doublon.creer }).click();

  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID_2}`);
  expect(sent).toEqual([
    { codeInsee: NIMES.codeInsee, risque: 'INONDATION', eventDate: EVENT_DATE },
    {
      codeInsee: NIMES.codeInsee,
      risque: 'INONDATION',
      eventDate: EVENT_DATE,
      confirmNew: true,
    },
  ]);
});

test('a confirmation that fails says so and leaves the existing dossier reachable', async ({
  page,
}) => {
  const sent = await openConflict(page, {
    status: 500,
    contentType: 'application/json',
    body: '{}',
  });

  await page.getByRole('button', { name: fr.sinistres.doublon.creer }).click();

  await expect(page.getByTestId('request-error')).toBeVisible();
  // The screen that asked is the only place the dossier already there can
  // still be opened from, so a failure must not take it away.
  await expect(
    page.getByRole('link', { name: fr.sinistres.doublon.ouvrir }),
  ).toBeVisible();
  expect(sent).toHaveLength(2);
});

test('a confirmation the API refuses is reported on the question, not on the date field behind it', async ({
  page,
}) => {
  await openConflict(page, {
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ message: ['La date ne peut pas être future'] }),
  });

  await page.getByRole('button', { name: fr.sinistres.doublon.creer }).click();

  await expect(page.getByTestId('request-error')).toBeVisible();
  await expect(
    page.getByRole('link', { name: fr.sinistres.doublon.ouvrir }),
  ).toBeVisible();
});

test('while the second dossier is being created, the link to the existing one does not fire', async ({
  page,
}) => {
  const held = deferred();
  await openConflict(page, {
    ...createdReply(SINISTRE_ID_2, 201),
    after: held.promise,
  });

  await page.getByRole('button', { name: fr.sinistres.doublon.creer }).click();
  const ouvrir = page.getByRole('link', { name: fr.sinistres.doublon.ouvrir });
  await expect(ouvrir).toHaveAttribute('aria-disabled', 'true');
  await ouvrir.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/sinistres/nouveau');

  held.release();
  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID_2}`);
});

test('a dossier with all three parameters already there (200) opens straight away, with no question', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await mockSession(page).install();
  // The API answers with the dossier itself instead of creating a second one,
  // so there is nothing to confirm.
  const sent = await mockCreateSinistre(page, [
    createdReply(SINISTRE_ID_1, 200),
  ]);

  await submitNouveau(page);

  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID_1}`);
  expect(sent).toHaveLength(1);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the conflict screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openConflict(page);

    await expectNoAxeViolations(page);
  });
}

test('“revenir et corriger” gives the form back as it was sent, on the date', async ({
  page,
}) => {
  const sent = await openConflict(page);

  await page
    .getByRole('button', { name: fr.sinistres.doublon.corriger })
    .click();

  const date = page.getByLabel(fr.sinistres.nouveau.eventDateLabel);
  await expect(date).toBeFocused();
  await expect(date).toHaveValue(EVENT_DATE);
  await expect(page.getByTestId('request-error')).toHaveCount(0);

  await date.fill(EXISTING_DATE);
  await page.getByRole('button', { name: fr.sinistres.nouveau.submit }).click();

  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID_2}`);
  expect(sent.map((body) => body.eventDate)).toEqual([
    EVENT_DATE,
    EXISTING_DATE,
  ]);
});
