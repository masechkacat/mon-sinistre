import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';

const TOKEN = 'jeton-desinscription';

test('the page shows the unsubscribe button and does not call the API before the click', async ({
  page,
}) => {
  let called = false;
  await page.route(`${testApiBaseUrl}/veille/desinscription**`, (route) => {
    called = true;
    return route.fulfill({ status: 204 });
  });

  await page.goto(`/veille/desinscription/confirmer?token=${TOKEN}`);

  await expect(
    page.getByRole('button', {
      name: fr.veille.desinscription.confirmer.unsubscribeButton,
    }),
  ).toBeVisible();
  expect(called).toBe(false);
});

test('clicking the button unsubscribes, changes the screen, and announces the result to screen readers', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/veille/desinscription**`, (route) => {
    expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
      token: TOKEN,
    });
    return route.fulfill({ status: 204 });
  });

  await page.goto(`/veille/desinscription/confirmer?token=${TOKEN}`);
  await page
    .getByRole('button', {
      name: fr.veille.desinscription.confirmer.unsubscribeButton,
    })
    .click();

  // Ordering rationale: tests/veille-confirmation.spec.ts, same assertion.
  await expect(page.getByTestId('veille-desinscription-result')).toBeFocused();
  const status = page.getByRole('status');
  await expect(status).toContainText(
    fr.veille.desinscription.confirmer.done.title,
  );
  await expect(status).toContainText(
    fr.veille.desinscription.confirmer.done.description,
  );
  await expect(
    page.getByRole('heading', {
      name: fr.veille.desinscription.confirmer.done.title,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: fr.veille.desinscription.confirmer.unsubscribeButton,
    }),
  ).toHaveCount(0);
});

test('a second visit through the same link shows the same screen without error, because the API is idempotent', async ({
  page,
}) => {
  // The API answers 204 unconditionally on every call — this mock stands in
  // for "already unsubscribed", the state a second visit finds.
  await page.route(`${testApiBaseUrl}/veille/desinscription**`, (route) =>
    route.fulfill({ status: 204 }),
  );

  await page.goto(`/veille/desinscription/confirmer?token=${TOKEN}`);
  await page
    .getByRole('button', {
      name: fr.veille.desinscription.confirmer.unsubscribeButton,
    })
    .click();

  await expect(
    page.getByRole('heading', {
      name: fr.veille.desinscription.confirmer.done.title,
    }),
  ).toBeVisible();
  await expect(page.getByTestId('request-error')).toHaveCount(0);
});

test('an unreachable API shows the French error message', async ({ page }) => {
  await page.route(`${testApiBaseUrl}/veille/desinscription**`, (route) =>
    route.abort(),
  );

  await page.goto(`/veille/desinscription/confirmer?token=${TOKEN}`);
  await page
    .getByRole('button', {
      name: fr.veille.desinscription.confirmer.unsubscribeButton,
    })
    .click();

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the button screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/veille/desinscription**`, (route) =>
      route.fulfill({ status: 204 }),
    );
    await page.goto(`/veille/desinscription/confirmer?token=${TOKEN}`);
    await expect(
      page.getByRole('button', {
        name: fr.veille.desinscription.confirmer.unsubscribeButton,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the result screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/veille/desinscription**`, (route) =>
      route.fulfill({ status: 204 }),
    );
    await page.goto(`/veille/desinscription/confirmer?token=${TOKEN}`);
    await page
      .getByRole('button', {
        name: fr.veille.desinscription.confirmer.unsubscribeButton,
      })
      .click();
    await expect(
      page.getByRole('heading', {
        name: fr.veille.desinscription.confirmer.done.title,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
