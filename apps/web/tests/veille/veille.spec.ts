import { expect, test } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { NIMES, mockCommuneSearch, selectNimes } from '../support/communes';
import { testApiBaseUrl } from '../support/env';
import { expectErrorTiedTo } from '../support/form';

test('submitting without a commune reports an error tied to the field, and does not send the request', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  let subscribeCalled = false;
  await page.route(`${testApiBaseUrl}/veille`, (route) => {
    subscribeCalled = true;
    return route.fulfill({ status: 204 });
  });

  await page.goto('/veille');
  await page.getByLabel(fr.veille.form.emailLabel).fill('riverain@example.fr');
  await page.getByRole('button', { name: fr.veille.form.submit }).click();

  await expectErrorTiedTo(
    page.getByLabel(fr.veille.form.communesLabel),
    page.getByText(fr.veille.form.communesRequiredError),
  );
  expect(subscribeCalled).toBe(false);
});

test('submitting with an invalid email reports an error tied to the field, and does not send the request', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  let subscribeCalled = false;
  await page.route(`${testApiBaseUrl}/veille`, (route) => {
    subscribeCalled = true;
    return route.fulfill({ status: 204 });
  });

  await page.goto('/veille');
  await selectNimes(page);
  const emailInput = page.getByLabel(fr.veille.form.emailLabel);
  await emailInput.fill('pas-une-adresse');
  await page.getByRole('button', { name: fr.veille.form.submit }).click();

  await expectErrorTiedTo(
    emailInput,
    page.getByText(fr.veille.form.emailInvalidError),
  );
  expect(subscribeCalled).toBe(false);
});

test('a successful submission shows the confirmation screen, announced to screen readers', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.route(`${testApiBaseUrl}/veille`, (route) => {
    expect(route.request().method()).toBe('POST');
    expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
      email: 'riverain@example.fr',
      communeCodes: [NIMES.codeInsee],
    });
    return route.fulfill({ status: 204 });
  });

  await page.goto('/veille');
  await selectNimes(page);
  await page.getByLabel(fr.veille.form.emailLabel).fill('riverain@example.fr');
  await page.getByRole('button', { name: fr.veille.form.submit }).click();

  // Focus moves to the confirmation: the button the user just pressed is
  // gone, and without a target a keyboard user restarts from the page top.
  // Asserted first: it also waits out the form, whose own empty status
  // regions would otherwise trip getByRole('status') strict mode.
  await expect(page.getByTestId('veille-confirmation')).toBeFocused();
  const status = page.getByRole('status');
  await expect(status).toContainText(fr.veille.confirmationSent.title);
  await expect(status).toContainText(fr.veille.confirmationSent.description);
});

test('an unavailable API shows the French error message, not a blank screen', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.route(`${testApiBaseUrl}/veille`, (route) => route.abort());

  await page.goto('/veille');
  await selectNimes(page);
  await page.getByLabel(fr.veille.form.emailLabel).fill('riverain@example.fr');
  await page.getByRole('button', { name: fr.veille.form.submit }).click();

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
});

test('the page shows the purpose of the email address and links to the privacy policy', async ({
  page,
}) => {
  await page.goto('/veille');
  await expect(page.getByText(fr.veille.form.purpose)).toBeVisible();
  await expect(
    page.getByRole('link', { name: fr.veille.form.privacyPolicyLink }),
  ).toHaveAttribute('href', '/politique-de-confidentialite');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the confirmation screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
    await page.route(`${testApiBaseUrl}/veille`, (route) =>
      route.fulfill({ status: 204 }),
    );

    await page.goto('/veille');
    await selectNimes(page);
    await page
      .getByLabel(fr.veille.form.emailLabel)
      .fill('riverain@example.fr');
    await page.getByRole('button', { name: fr.veille.form.submit }).click();
    await expect(
      page.getByRole('heading', { name: fr.veille.confirmationSent.title }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the field errors are clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
    await page.goto('/veille');
    await page.getByRole('button', { name: fr.veille.form.submit }).click();
    await expect(
      page.getByText(fr.veille.form.communesRequiredError),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
