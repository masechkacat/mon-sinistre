import { expect, test } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { NIMES, mockCommuneSearch, selectNimes } from '../support/communes';
import { testApiBaseUrl } from '../support/env';
import { expectErrorTiedTo } from '../support/form';
import { mockSession } from '../support/session-mock';

const SINISTRE_ID = '11111111-1111-1111-1111-111111111111';

function sinistreDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SINISTRE_ID,
    communeCode: NIMES.codeInsee,
    risque: 'INONDATION',
    eventDate: '2026-06-15',
    arreteEntryId: null,
    declarationDate: null,
    status: 'AVANT_ARRETE',
    createdAt: '2026-06-16T08:00:00.000Z',
    steps: [],
    ...overrides,
  };
}

async function selectCommuneAndRisque(page: import('@playwright/test').Page) {
  await selectNimes(page, fr.sinistres.nouveau.communeLabel);
  await page
    .getByRole('radio', { name: fr.sinistres.risque.options.INONDATION.label })
    .click();
}

test('submitting empty reports errors tied to each field, and does not send the request', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  let createCalled = false;
  await page.route(`${testApiBaseUrl}/sinistres`, (route) => {
    createCalled = true;
    return route.fulfill({ status: 201, body: '{}' });
  });
  await mockSession(page).install();

  await page.goto('/sinistres/nouveau');
  await page.getByRole('button', { name: fr.sinistres.nouveau.submit }).click();

  await expectErrorTiedTo(
    page.getByLabel(fr.sinistres.nouveau.communeLabel),
    page.getByText(fr.sinistres.nouveau.communeRequiredError),
  );
  await expectErrorTiedTo(
    page.getByRole('radiogroup'),
    page.getByText(fr.sinistres.risque.requiredError),
  );
  await expectErrorTiedTo(
    page.getByLabel(fr.sinistres.nouveau.eventDateLabel),
    page.getByText(fr.sinistres.nouveau.eventDateRequiredError),
  );
  expect(createCalled).toBe(false);
});

test('a future event date shows the API’s French error, tied to the field and announced', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  const FUTURE_ERROR = 'La date de l’événement ne peut pas être dans le futur.';
  await page.route(`${testApiBaseUrl}/sinistres`, (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 400,
        message: [FUTURE_ERROR],
        error: 'Bad Request',
      }),
    }),
  );
  await mockSession(page).install();

  await page.goto('/sinistres/nouveau');
  await selectCommuneAndRisque(page);
  const dateInput = page.getByLabel(fr.sinistres.nouveau.eventDateLabel);
  await dateInput.fill('2099-01-01');
  await page.getByRole('button', { name: fr.sinistres.nouveau.submit }).click();

  const error = page.getByText(FUTURE_ERROR);
  await expectErrorTiedTo(dateInput, error);
});

test('an unrelated 400 (a plain business error, not a field validator) shows the generic error banner, not a mislabelled field error', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  // Shaped like SinistresService.create's `BadRequestException('Commune
  // inconnue.')`: a plain string `message`, not the array a DTO validator
  // (ValidationPipe) always answers with — the two must not be confused.
  await page.route(`${testApiBaseUrl}/sinistres`, (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 400,
        message: 'Commune inconnue.',
        error: 'Bad Request',
      }),
    }),
  );
  await mockSession(page).install();

  await page.goto('/sinistres/nouveau');
  await selectCommuneAndRisque(page);
  const dateInput = page.getByLabel(fr.sinistres.nouveau.eventDateLabel);
  await dateInput.fill('2026-06-15');
  await page.getByRole('button', { name: fr.sinistres.nouveau.submit }).click();

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(page.getByText('Commune inconnue.')).toHaveCount(0);
  await expect(dateInput).not.toHaveAttribute('aria-describedby');
});

test('a successful submission leads to the sinistre screen', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.route(`${testApiBaseUrl}/sinistres`, (route) => {
    expect(route.request().method()).toBe('POST');
    expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
      codeInsee: NIMES.codeInsee,
      risque: 'INONDATION',
      eventDate: '2026-06-15',
    });
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(sinistreDetail()),
    });
  });
  await mockSession(page).install();

  await page.goto('/sinistres/nouveau');
  await selectCommuneAndRisque(page);
  await page.getByLabel(fr.sinistres.nouveau.eventDateLabel).fill('2026-06-15');
  await page.getByRole('button', { name: fr.sinistres.nouveau.submit }).click();

  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID}`);
});

test('the whole form is operable with the keyboard alone', async ({ page }) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.route(`${testApiBaseUrl}/sinistres`, (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(sinistreDetail()),
    }),
  );
  await mockSession(page).install();

  await page.goto('/sinistres/nouveau');

  const communeInput = page.getByLabel(fr.sinistres.nouveau.communeLabel);
  await communeInput.focus();
  await page.keyboard.type('Nimes');
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  // One Tab from the combobox reaches the radio group — roving tabindex
  // lands on its first item — and arrow keys move the selection inside it
  // (WAI-ARIA radiogroup pattern).
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('radio', {
      name: fr.sinistres.risque.options.INONDATION.label,
    }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('radio', {
      name: fr.sinistres.risque.options.SECHERESSE.label,
    }),
  ).toBeChecked();

  // A single Tab leaves the whole group for the date field, same as any
  // native radiogroup. `fill` rather than typed digits: a native date input
  // splits keystrokes across day/month/year segments in an order that
  // depends on the browser's locale, not on this app — already a
  // keyboard-accessible native control before this form touches it.
  await page.keyboard.press('Tab');
  const dateInput = page.getByLabel(fr.sinistres.nouveau.eventDateLabel);
  await expect(dateInput).toBeFocused();
  await dateInput.fill('2026-06-15');

  await page.getByRole('button', { name: fr.sinistres.nouveau.submit }).focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID}`);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the field errors are clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
    await mockSession(page).install();

    await page.goto('/sinistres/nouveau');
    await page
      .getByRole('button', { name: fr.sinistres.nouveau.submit })
      .click();
    await expect(
      page.getByText(fr.sinistres.nouveau.communeRequiredError),
    ).toBeVisible();

    await expectNoAxeViolations(page);
  });
}
