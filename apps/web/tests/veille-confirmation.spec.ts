import { expect, test, type Route as PlaywrightRoute } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';

const PENDING_TOKEN = 'jeton-en-attente';
const ACTIVE_TOKEN = 'jeton-actif';

function fulfillStatus(route: PlaywrightRoute, status: string) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status }),
  });
}

async function mockGetStatus(route: PlaywrightRoute, status: string) {
  if (route.request().method() !== 'GET') return route.continue();
  return fulfillStatus(route, status);
}

test('a pending token shows the confirm button and does not activate the subscription before the click', async ({
  page,
}) => {
  let postCalled = false;
  await page.route(`${testApiBaseUrl}/veille/confirmation**`, (route) => {
    if (route.request().method() === 'POST') {
      postCalled = true;
      return fulfillStatus(route, 'active');
    }
    return fulfillStatus(route, 'pending');
  });

  await page.goto(`/veille/confirmation?token=${PENDING_TOKEN}`);

  await expect(
    page.getByRole('button', { name: fr.veille.confirmation.confirmButton }),
  ).toBeVisible();
  expect(postCalled).toBe(false);
});

test('clicking the button activates the subscription, changes the screen, and announces the result to screen readers', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/veille/confirmation**`, (route) => {
    if (route.request().method() === 'POST') {
      expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
        token: PENDING_TOKEN,
      });
      return fulfillStatus(route, 'active');
    }
    return fulfillStatus(route, 'pending');
  });

  await page.goto(`/veille/confirmation?token=${PENDING_TOKEN}`);
  await page
    .getByRole('button', { name: fr.veille.confirmation.confirmButton })
    .click();

  // The button the user just pressed unmounts with the pending screen —
  // asserted first: it also waits out the transition before the status
  // region is read, mirroring tests/veille.spec.ts.
  await expect(page.getByTestId('veille-confirmation-result')).toBeFocused();
  const status = page.getByRole('status');
  await expect(status).toContainText(fr.veille.confirmation.active.title);
  await expect(status).toContainText(fr.veille.confirmation.active.description);
  await expect(
    page.getByRole('heading', { name: fr.veille.confirmation.active.title }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: fr.veille.confirmation.confirmButton }),
  ).toHaveCount(0);
});

test('revisiting an already active token shows the active screen without a button, and without an error', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/veille/confirmation**`, (route) =>
    mockGetStatus(route, 'active'),
  );

  await page.goto(`/veille/confirmation?token=${ACTIVE_TOKEN}`);

  await expect(
    page.getByRole('heading', { name: fr.veille.confirmation.active.title }),
  ).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('request-error')).toHaveCount(0);
});

test('an unreachable API shows the French error message, not "lien invalide"', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/veille/confirmation**`, (route) =>
    route.abort(),
  );

  await page.goto(`/veille/confirmation?token=${PENDING_TOKEN}`);

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
  await expect(
    page.getByRole('heading', { name: fr.veille.confirmation.invalid.title }),
  ).toHaveCount(0);
});

test('an unknown token shows "lien invalide"', async ({ page }) => {
  await page.route(`${testApiBaseUrl}/veille/confirmation**`, (route) =>
    mockGetStatus(route, 'invalid'),
  );

  await page.goto('/veille/confirmation?token=inconnu');

  await expect(
    page.getByRole('heading', { name: fr.veille.confirmation.invalid.title }),
  ).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the pending screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/veille/confirmation**`, (route) =>
      mockGetStatus(route, 'pending'),
    );
    await page.goto(`/veille/confirmation?token=${PENDING_TOKEN}`);
    await expect(
      page.getByRole('button', {
        name: fr.veille.confirmation.confirmButton,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the active screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/veille/confirmation**`, (route) =>
      mockGetStatus(route, 'active'),
    );
    await page.goto(`/veille/confirmation?token=${ACTIVE_TOKEN}`);
    await expect(
      page.getByRole('heading', {
        name: fr.veille.confirmation.active.title,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the "lien invalide" screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/veille/confirmation**`, (route) =>
      mockGetStatus(route, 'invalid'),
    );
    await page.goto('/veille/confirmation?token=inconnu');
    await expect(
      page.getByRole('heading', {
        name: fr.veille.confirmation.invalid.title,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
