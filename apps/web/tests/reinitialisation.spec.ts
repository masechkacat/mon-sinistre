import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';
import {
  expectErrorTiedTo,
  fulfillStatus,
  VALID_PASSWORD,
  WEAK_PASSWORD,
} from './form';

const RESET_TOKEN = 'jeton-reinitialisation';

test('submitting with an empty password reports an error tied to the field, and does not send the request', async ({
  page,
}) => {
  let confirmCalled = false;
  await page.route(`${testApiBaseUrl}/auth/password-reset/confirm`, (route) => {
    confirmCalled = true;
    return fulfillStatus(route, 'reset');
  });

  await page.goto(`/reinitialisation?token=${RESET_TOKEN}`);
  const passwordInput = page.getByLabel(
    fr.compte.reinitialisation.passwordLabel,
  );
  await page
    .getByRole('button', { name: fr.compte.reinitialisation.submit })
    .click();

  await expectErrorTiedTo(
    passwordInput,
    page.getByText(fr.compte.reinitialisation.passwordRequiredError),
  );
  expect(confirmCalled).toBe(false);
});

test('submitting with a password that does not meet the CNIL rules reports an error tied to the field, and does not send the request', async ({
  page,
}) => {
  let confirmCalled = false;
  await page.route(`${testApiBaseUrl}/auth/password-reset/confirm`, (route) => {
    confirmCalled = true;
    return fulfillStatus(route, 'reset');
  });

  await page.goto(`/reinitialisation?token=${RESET_TOKEN}`);
  const passwordInput = page.getByLabel(
    fr.compte.reinitialisation.passwordLabel,
  );
  await passwordInput.fill(WEAK_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.reinitialisation.submit })
    .click();

  await expectErrorTiedTo(
    passwordInput,
    page.getByText(fr.compte.reinitialisation.passwordRequirementsError),
  );
  expect(confirmCalled).toBe(false);
});

test('a successful reset sends the token and the new password, and lands on the login page', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/password-reset/confirm`, (route) => {
    expect(route.request().method()).toBe('POST');
    expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
      token: RESET_TOKEN,
      password: VALID_PASSWORD,
    });
    return fulfillStatus(route, 'reset');
  });

  await page.goto(`/reinitialisation?token=${RESET_TOKEN}`);
  await page
    .getByLabel(fr.compte.reinitialisation.passwordLabel)
    .fill(VALID_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.reinitialisation.submit })
    .click();

  await expect(page).toHaveURL(/\/connexion$/);
});

test('a rejected token shows "lien invalide" after the submit, announced to screen readers', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/password-reset/confirm`, (route) =>
    fulfillStatus(route, 'invalid'),
  );

  await page.goto(`/reinitialisation?token=${RESET_TOKEN}`);
  await page
    .getByLabel(fr.compte.reinitialisation.passwordLabel)
    .fill(VALID_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.reinitialisation.submit })
    .click();

  await expect(page.getByTestId('reinitialisation-invalid')).toBeFocused();
  const status = page.getByRole('status');
  await expect(status).toContainText(fr.compte.reinitialisation.invalid.title);
  await expect(status).toContainText(
    fr.compte.reinitialisation.invalid.description,
  );
  await expect(
    page.getByRole('button', { name: fr.compte.reinitialisation.submit }),
  ).toHaveCount(0);
});

test('a missing token shows "lien invalide" immediately, without calling the API', async ({
  page,
}) => {
  let called = false;
  await page.route(`${testApiBaseUrl}/auth/password-reset/confirm`, (route) => {
    called = true;
    return fulfillStatus(route, 'reset');
  });

  await page.goto('/reinitialisation');

  await expect(
    page.getByRole('heading', {
      name: fr.compte.reinitialisation.invalid.title,
    }),
  ).toBeVisible();
  expect(called).toBe(false);
});

test('an unreachable API shows the French error message, not "lien invalide"', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/password-reset/confirm`, (route) =>
    route.abort(),
  );

  await page.goto(`/reinitialisation?token=${RESET_TOKEN}`);
  await page
    .getByLabel(fr.compte.reinitialisation.passwordLabel)
    .fill(VALID_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.reinitialisation.submit })
    .click();

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
  await expect(
    page.getByRole('heading', {
      name: fr.compte.reinitialisation.invalid.title,
    }),
  ).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the form is clean — theme ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(`/reinitialisation?token=${RESET_TOKEN}`);
    await expect(
      page.getByLabel(fr.compte.reinitialisation.passwordLabel),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the field error is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(`/reinitialisation?token=${RESET_TOKEN}`);
    await page
      .getByRole('button', { name: fr.compte.reinitialisation.submit })
      .click();
    await expect(
      page.getByText(fr.compte.reinitialisation.passwordRequiredError),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the invalid screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/reinitialisation');
    await expect(
      page.getByRole('heading', {
        name: fr.compte.reinitialisation.invalid.title,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
