import { expect, test, type Page, type Route } from '@playwright/test';
import type { Commune } from '@mon-sinistre/contracts';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';

const NIMES: Commune = {
  codeInsee: '30189',
  name: 'Nîmes',
  departementCode: '30',
  departementName: 'Gard',
};

async function mockCommuneSearch(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([NIMES]),
  });
}

async function selectNimes(page: Page) {
  const input = page.getByLabel(fr.veille.form.communesLabel);
  await input.focus();
  await page.keyboard.type('Nimes');
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

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

  const error = page.getByText(fr.veille.form.communesRequiredError);
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(page.getByLabel(fr.veille.form.communesLabel)).toHaveAttribute(
    'aria-describedby',
    await error.getAttribute('id'),
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

  const error = page.getByText(fr.veille.form.emailInvalidError);
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(emailInput).toHaveAttribute(
    'aria-describedby',
    await error.getAttribute('id'),
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
    await expect(page.getByRole('status')).toBeVisible();
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
