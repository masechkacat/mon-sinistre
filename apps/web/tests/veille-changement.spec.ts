import { expect, test, type Route as PlaywrightRoute } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';

const PENDING_TOKEN = 'jeton-changement-en-attente';

const PENDING_COMMUNES = [
  { name: 'Lourdes', departementName: 'Hautes-Pyrénées' },
  { name: 'Tarbes', departementName: 'Hautes-Pyrénées' },
];

function fulfillGet(route: PlaywrightRoute) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'pending', communes: PENDING_COMMUNES }),
  });
}

test('a pending token shows the new composition and the button, and does not apply it before the click', async ({
  page,
}) => {
  let postCalled = false;
  await page.route(`${testApiBaseUrl}/veille/changement**`, (route) => {
    if (route.request().method() === 'POST') {
      postCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'applied' }),
      });
    }
    return fulfillGet(route);
  });

  await page.goto(`/veille/changement?token=${PENDING_TOKEN}`);

  for (const commune of PENDING_COMMUNES) {
    await expect(
      page.getByText(`${commune.name} (${commune.departementName})`),
    ).toBeVisible();
  }
  await expect(
    page.getByRole('button', { name: fr.veille.change.confirmButton }),
  ).toBeVisible();
  expect(postCalled).toBe(false);
});

test('the live region is already mounted on the pending screen, before it has anything to announce', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/veille/changement**`, fulfillGet);

  await page.goto(`/veille/changement?token=${PENDING_TOKEN}`);
  await expect(
    page.getByRole('button', { name: fr.veille.change.confirmButton }),
  ).toBeVisible();

  // The live-region rule of apps/web/CLAUDE.md, which this suite's other
  // assertions cannot see: they read a region that is there, never whether
  // it was there in time to be announced.
  await expect(page.getByRole('status')).toBeAttached();
  await expect(page.getByRole('status')).toBeEmpty();
});

test('clicking the button applies the change, changes the screen, and announces the result to screen readers', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/veille/changement**`, (route) => {
    if (route.request().method() === 'POST') {
      expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
        token: PENDING_TOKEN,
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'applied' }),
      });
    }
    return fulfillGet(route);
  });

  await page.goto(`/veille/changement?token=${PENDING_TOKEN}`);
  await page
    .getByRole('button', { name: fr.veille.change.confirmButton })
    .click();

  // Ordering rationale: tests/veille-confirmation.spec.ts, same assertion.
  await expect(page.getByTestId('veille-change-result')).toBeFocused();
  const status = page.getByRole('status');
  await expect(status).toContainText(fr.veille.change.applied.title);
  await expect(status).toContainText(fr.veille.change.applied.description);
  await expect(
    page.getByRole('heading', { name: fr.veille.change.applied.title }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: fr.veille.change.confirmButton }),
  ).toHaveCount(0);
});

test('a status refetch that fails after applying does not take the applied screen away', async ({
  page,
}) => {
  let getCalls = 0;
  await page.route(`${testApiBaseUrl}/veille/changement**`, (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'applied' }),
      });
    getCalls += 1;
    // Only the first GET answers: the rest stand in for the request the
    // applied request just deleted (GET on it now answers "invalid") or a
    // lost connection right after applying.
    return getCalls === 1 ? fulfillGet(route) : route.abort();
  });

  await page.goto(`/veille/changement?token=${PENDING_TOKEN}`);
  await page
    .getByRole('button', { name: fr.veille.change.confirmButton })
    .click();
  await expect(
    page.getByRole('heading', { name: fr.veille.change.applied.title }),
  ).toBeVisible();

  // Ordering rationale: tests/veille-confirmation.spec.ts, same assertion —
  // the query stays mounted and refetches on window focus; two full
  // refetches (retry: 1) are awaited so the failure has been through the
  // query's error state and the render it triggers before asserting below.
  const refetchOnFocus = async () => {
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      window.dispatchEvent(new Event('visibilitychange'));
    });
    return getCalls;
  };
  await expect.poll(refetchOnFocus).toBeGreaterThanOrEqual(5);

  await expect(
    page.getByRole('heading', { name: fr.veille.change.applied.title }),
  ).toBeVisible();
  await expect(page.getByTestId('request-error')).toHaveCount(0);
});

test('an unreachable API shows the French error message, not "lien invalide"', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/veille/changement**`, (route) =>
    route.abort(),
  );

  await page.goto(`/veille/changement?token=${PENDING_TOKEN}`);

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
  await expect(
    page.getByRole('heading', { name: fr.veille.change.invalid.title }),
  ).toHaveCount(0);
});

test('an unknown token shows "lien invalide"', async ({ page }) => {
  await page.route(`${testApiBaseUrl}/veille/changement**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'invalid' }),
    }),
  );

  await page.goto('/veille/changement?token=inconnu');

  await expect(
    page.getByRole('heading', { name: fr.veille.change.invalid.title }),
  ).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the pending screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/veille/changement**`, fulfillGet);
    await page.goto(`/veille/changement?token=${PENDING_TOKEN}`);
    await expect(
      page.getByRole('button', { name: fr.veille.change.confirmButton }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the applied screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/veille/changement**`, (route) => {
      if (route.request().method() === 'POST')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'applied' }),
        });
      return fulfillGet(route);
    });
    await page.goto(`/veille/changement?token=${PENDING_TOKEN}`);
    await page
      .getByRole('button', { name: fr.veille.change.confirmButton })
      .click();
    await expect(
      page.getByRole('heading', { name: fr.veille.change.applied.title }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
