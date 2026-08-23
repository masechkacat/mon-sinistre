import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';
import { expectErrorTiedTo, VALID_PASSWORD, WEAK_PASSWORD } from './form';

test('submitting with a password that does not meet the CNIL rules reports an error tied to the field, and does not send the request', async ({
  page,
}) => {
  let registerCalled = false;
  await page.route(`${testApiBaseUrl}/auth/register`, (route) => {
    registerCalled = true;
    return route.fulfill({ status: 204 });
  });

  await page.goto('/inscription');
  await page
    .getByLabel(fr.compte.inscription.emailLabel)
    .fill('sinistre@example.fr');
  const passwordInput = page.getByLabel(fr.compte.inscription.passwordLabel);
  await passwordInput.fill(WEAK_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.inscription.submit })
    .click();

  await expectErrorTiedTo(
    passwordInput,
    page.getByText(fr.compte.inscription.passwordRequirementsError),
  );
  expect(registerCalled).toBe(false);
});

test('submitting with an invalid email reports an error tied to the field, and does not send the request', async ({
  page,
}) => {
  let registerCalled = false;
  await page.route(`${testApiBaseUrl}/auth/register`, (route) => {
    registerCalled = true;
    return route.fulfill({ status: 204 });
  });

  await page.goto('/inscription');
  const emailInput = page.getByLabel(fr.compte.inscription.emailLabel);
  await emailInput.fill('pas-une-adresse');
  await page
    .getByLabel(fr.compte.inscription.passwordLabel)
    .fill(VALID_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.inscription.submit })
    .click();

  await expectErrorTiedTo(
    emailInput,
    page.getByText(fr.compte.inscription.emailInvalidError),
  );
  expect(registerCalled).toBe(false);
});

test('a successful registration shows the "check your email" screen, announced to screen readers', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/register`, (route) => {
    expect(route.request().method()).toBe('POST');
    expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
      email: 'sinistre@example.fr',
      password: VALID_PASSWORD,
    });
    return route.fulfill({ status: 204 });
  });

  await page.goto('/inscription');
  await page
    .getByLabel(fr.compte.inscription.emailLabel)
    .fill('sinistre@example.fr');
  await page
    .getByLabel(fr.compte.inscription.passwordLabel)
    .fill(VALID_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.inscription.submit })
    .click();

  // Focus moves to the confirmation screen, mirroring tests/veille.spec.ts —
  // asserted first, it also waits out the form before the status region is
  // read.
  await expect(page.getByTestId('inscription-confirmation')).toBeFocused();
  const status = page.getByRole('status');
  await expect(status).toContainText(
    fr.compte.inscription.confirmationSent.title,
  );
  await expect(status).toContainText(
    fr.compte.inscription.confirmationSent.description,
  );
});

test('an unavailable API shows the French error message, not a blank screen', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/register`, (route) => route.abort());

  await page.goto('/inscription');
  await page
    .getByLabel(fr.compte.inscription.emailLabel)
    .fill('sinistre@example.fr');
  await page
    .getByLabel(fr.compte.inscription.passwordLabel)
    .fill(VALID_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.inscription.submit })
    .click();

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
});

test('the page shows the purpose of the data and links to the privacy policy', async ({
  page,
}) => {
  await page.goto('/inscription');
  await expect(page.getByText(fr.compte.inscription.purpose)).toBeVisible();
  await expect(
    page.getByRole('link', { name: fr.compte.inscription.privacyPolicyLink }),
  ).toHaveAttribute('href', '/politique-de-confidentialite');
});

test('the page links to the login page', async ({ page }) => {
  await page.goto('/inscription');
  await expect(
    page.getByRole('link', { name: fr.compte.inscription.loginLink }),
  ).toHaveAttribute('href', '/connexion');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the confirmation screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/auth/register`, (route) =>
      route.fulfill({ status: 204 }),
    );

    await page.goto('/inscription');
    await page
      .getByLabel(fr.compte.inscription.emailLabel)
      .fill('sinistre@example.fr');
    await page
      .getByLabel(fr.compte.inscription.passwordLabel)
      .fill(VALID_PASSWORD);
    await page
      .getByRole('button', { name: fr.compte.inscription.submit })
      .click();
    await expect(
      page.getByRole('heading', {
        name: fr.compte.inscription.confirmationSent.title,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the field errors are clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/inscription');
    await page
      .getByRole('button', { name: fr.compte.inscription.submit })
      .click();
    await expect(
      page.getByText(fr.compte.inscription.emailRequiredError),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
