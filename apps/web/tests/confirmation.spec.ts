import { expect, test, type Route as PlaywrightRoute } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';

const PENDING_TOKEN = 'jeton-en-attente';

function fulfillStatus(route: PlaywrightRoute, status: string) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status }),
  });
}

test('a token in the link shows the confirm button and does not activate the account before the click', async ({
  page,
}) => {
  let postCalled = false;
  await page.route(`${testApiBaseUrl}/auth/confirmation`, (route) => {
    postCalled = true;
    return fulfillStatus(route, 'confirmed');
  });

  await page.goto(`/confirmation?token=${PENDING_TOKEN}`);

  await expect(
    page.getByRole('button', { name: fr.compte.confirmation.confirmButton }),
  ).toBeVisible();
  expect(postCalled).toBe(false);
});

test('the live region is already mounted on the pending screen, before it has anything to announce', async ({
  page,
}) => {
  await page.goto(`/confirmation?token=${PENDING_TOKEN}`);
  await expect(
    page.getByRole('button', { name: fr.compte.confirmation.confirmButton }),
  ).toBeVisible();

  // The live-region rule of apps/web/CLAUDE.md, which toContainText
  // assertions elsewhere cannot see on their own.
  await expect(page.getByRole('status')).toBeAttached();
  await expect(page.getByRole('status')).toBeEmpty();
});

test('clicking the button activates the account, changes the screen, and announces the result to screen readers', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/confirmation`, (route) => {
    expect(route.request().method()).toBe('POST');
    expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
      token: PENDING_TOKEN,
    });
    return fulfillStatus(route, 'confirmed');
  });

  await page.goto(`/confirmation?token=${PENDING_TOKEN}`);
  await page
    .getByRole('button', { name: fr.compte.confirmation.confirmButton })
    .click();

  // The button the user just pressed unmounts with the pending screen —
  // asserted first, mirroring tests/veille-confirmation.spec.ts.
  await expect(page.getByTestId('compte-confirmation-result')).toBeFocused();
  const status = page.getByRole('status');
  await expect(status).toContainText(fr.compte.confirmation.confirmed.title);
  await expect(status).toContainText(
    fr.compte.confirmation.confirmed.description,
  );
  await expect(
    page.getByRole('heading', { name: fr.compte.confirmation.confirmed.title }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: fr.compte.confirmation.confirmButton }),
  ).toHaveCount(0);
});

test('a rejected token shows "lien invalide" after the click', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/confirmation`, (route) =>
    fulfillStatus(route, 'invalid'),
  );

  await page.goto(`/confirmation?token=inconnu`);
  await page
    .getByRole('button', { name: fr.compte.confirmation.confirmButton })
    .click();

  await expect(
    page.getByRole('heading', { name: fr.compte.confirmation.invalid.title }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: fr.compte.confirmation.confirmButton }),
  ).toHaveCount(0);
});

test('a missing token shows "lien invalide" immediately, without calling the API', async ({
  page,
}) => {
  let called = false;
  await page.route(`${testApiBaseUrl}/auth/confirmation`, (route) => {
    called = true;
    return fulfillStatus(route, 'confirmed');
  });

  await page.goto('/confirmation');

  await expect(
    page.getByRole('heading', { name: fr.compte.confirmation.invalid.title }),
  ).toBeVisible();
  expect(called).toBe(false);
});

test('an unreachable API shows the French error message, not "lien invalide"', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/confirmation`, (route) =>
    route.abort(),
  );

  await page.goto(`/confirmation?token=${PENDING_TOKEN}`);
  await page
    .getByRole('button', { name: fr.compte.confirmation.confirmButton })
    .click();

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
  await expect(
    page.getByRole('heading', { name: fr.compte.confirmation.invalid.title }),
  ).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the pending screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(`/confirmation?token=${PENDING_TOKEN}`);
    await expect(
      page.getByRole('button', {
        name: fr.compte.confirmation.confirmButton,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the confirmed screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/auth/confirmation`, (route) =>
      fulfillStatus(route, 'confirmed'),
    );
    await page.goto(`/confirmation?token=${PENDING_TOKEN}`);
    await page
      .getByRole('button', { name: fr.compte.confirmation.confirmButton })
      .click();
    await expect(
      page.getByRole('heading', {
        name: fr.compte.confirmation.confirmed.title,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the "lien invalide" screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/confirmation');
    await expect(
      page.getByRole('heading', {
        name: fr.compte.confirmation.invalid.title,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
