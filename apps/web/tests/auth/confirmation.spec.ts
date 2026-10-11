import { expect, test } from '@playwright/test';
import type { AccountConfirmationResponse } from '@mon-sinistre/contracts';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { testApiBaseUrl } from '../support/env';
import { fulfillStatus } from '../support/form';
import { SINISTRE_ID_1 } from '../support/sinistres';

const PENDING_TOKEN = 'jeton-en-attente';

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
  // Activation is not the end of the road: the screen has to offer the way
  // on, or the only route to the login page is typing its address.
  await expect(
    page.getByRole('link', { name: fr.compte.confirmation.loginLink }),
  ).toHaveAttribute('href', '/connexion');
});

test('a confirmation that created a dossier leads to it through the login page', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/confirmation`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'confirmed',
        sinistreId: SINISTRE_ID_1,
      } satisfies AccountConfirmationResponse),
    }),
  );

  await page.goto(`/confirmation?token=${PENDING_TOKEN}`);
  await page
    .getByRole('button', { name: fr.compte.confirmation.confirmButton })
    .click();

  const href = await page
    .getByTestId('compte-confirmation-login-link')
    .getAttribute('href');
  // Read back as an address rather than compared as a string: what matters is
  // the path the parameter carries, not how it was escaped on the way.
  const { pathname, searchParams } = new URL(href ?? '', testApiBaseUrl);
  expect(pathname).toBe('/connexion');
  expect(searchParams.get('suivant')).toBe(`/sinistres/${SINISTRE_ID_1}`);
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
