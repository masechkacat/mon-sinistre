import {
  expect,
  test,
  type Page,
  type Route as PlaywrightRoute,
} from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';
import { expectErrorTiedTo } from './form';

const EMAIL = 'sinistre@example.fr';
const PASSWORD = 'Abc12345!';

async function fillLoginForm(
  page: Page,
  { email, password }: { email: string; password: string },
) {
  await page.getByLabel(fr.compte.connexion.emailLabel).fill(email);
  await page.getByLabel(fr.compte.connexion.passwordLabel).fill(password);
  await page.getByRole('button', { name: fr.compte.connexion.submit }).click();
}

test('submitting with an empty password reports an error tied to the field, and does not send the request', async ({
  page,
}) => {
  let loginCalled = false;
  await page.route(`${testApiBaseUrl}/auth/login`, (route) => {
    loginCalled = true;
    return route.fulfill({ status: 200 });
  });

  await page.goto('/connexion');
  await page.getByLabel(fr.compte.connexion.emailLabel).fill(EMAIL);
  const passwordInput = page.getByLabel(fr.compte.connexion.passwordLabel);
  await page.getByRole('button', { name: fr.compte.connexion.submit }).click();

  await expectErrorTiedTo(
    passwordInput,
    page.getByText(fr.compte.connexion.passwordRequiredError),
  );
  expect(loginCalled).toBe(false);
});

test('an invalid pair shows one generic error message, announced to screen readers, without leaving the page', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/login`, (route: PlaywrightRoute) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{}',
    }),
  );

  await page.goto('/connexion');
  await fillLoginForm(page, { email: EMAIL, password: 'wrong-password' });

  const alert = page.getByTestId('connexion-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.compte.connexion.invalidError);
  await expect(page).toHaveURL(/\/connexion$/);
});

test('a successful login stores the access token and lands on espace personnel', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/login`, (route: PlaywrightRoute) => {
    expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
      email: EMAIL,
      password: PASSWORD,
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: 'jeton-acces-test' }),
    });
  });

  await page.goto('/connexion');
  await fillLoginForm(page, { email: EMAIL, password: PASSWORD });

  await expect(page).toHaveURL(/\/espace-personnel$/);
  await expect(page.getByTestId('espace-personnel-content')).toBeVisible();
});

test('an unavailable API shows the French error message, not a blank screen', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/login`, (route) => route.abort());

  await page.goto('/connexion');
  await fillLoginForm(page, { email: EMAIL, password: PASSWORD });

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the login form is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/connexion');
    await expectNoAxeViolations(page);
  });

  test(`axe: the invalid-credentials state is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/auth/login`, (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{}',
      }),
    );
    await page.goto('/connexion');
    await fillLoginForm(page, { email: EMAIL, password: 'wrong-password' });
    await expect(page.getByTestId('connexion-error')).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
