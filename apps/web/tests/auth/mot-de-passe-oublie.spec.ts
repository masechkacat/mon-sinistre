import { expect, test } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { testApiBaseUrl } from '../support/env';
import { expectErrorTiedTo } from '../support/form';

const EMAIL = 'sinistre@example.fr';

test('submitting with an invalid email reports an error tied to the field, and does not send the request', async ({
  page,
}) => {
  let requestCalled = false;
  await page.route(`${testApiBaseUrl}/auth/password-reset`, (route) => {
    requestCalled = true;
    return route.fulfill({ status: 204 });
  });

  await page.goto('/mot-de-passe-oublie');
  const emailInput = page.getByLabel(fr.compte.motDePasseOublie.emailLabel);
  await emailInput.fill('pas-une-adresse');
  await page
    .getByRole('button', { name: fr.compte.motDePasseOublie.submit })
    .click();

  await expectErrorTiedTo(
    emailInput,
    page.getByText(fr.compte.motDePasseOublie.emailInvalidError),
  );
  expect(requestCalled).toBe(false);
});

// The response is identical whether the address exists or not
// (docs/prd/user-account.md, «Ограничения» — anti-enumeration) — this suite
// asserts the same screen shows up for an address the mock does not
// distinguish in any way, matching what the API itself does (always 204).
test('a submission always shows the same "check your email" screen, announced to screen readers', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/password-reset`, (route) => {
    expect(route.request().method()).toBe('POST');
    expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
      email: EMAIL,
    });
    return route.fulfill({ status: 204 });
  });

  await page.goto('/mot-de-passe-oublie');
  await page.getByLabel(fr.compte.motDePasseOublie.emailLabel).fill(EMAIL);
  await page
    .getByRole('button', { name: fr.compte.motDePasseOublie.submit })
    .click();

  await expect(page.getByTestId('mot-de-passe-oublie-sent')).toBeFocused();
  const status = page.getByRole('status');
  await expect(status).toContainText(fr.compte.motDePasseOublie.sent.title);
  await expect(status).toContainText(
    fr.compte.motDePasseOublie.sent.description,
  );
});

test('an unavailable API shows the French error message, not a blank screen', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/password-reset`, (route) =>
    route.abort(),
  );

  await page.goto('/mot-de-passe-oublie');
  await page.getByLabel(fr.compte.motDePasseOublie.emailLabel).fill(EMAIL);
  await page
    .getByRole('button', { name: fr.compte.motDePasseOublie.submit })
    .click();

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the sent screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/auth/password-reset`, (route) =>
      route.fulfill({ status: 204 }),
    );

    await page.goto('/mot-de-passe-oublie');
    await page.getByLabel(fr.compte.motDePasseOublie.emailLabel).fill(EMAIL);
    await page
      .getByRole('button', { name: fr.compte.motDePasseOublie.submit })
      .click();
    await expect(
      page.getByRole('heading', {
        name: fr.compte.motDePasseOublie.sent.title,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`axe: the field error is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/mot-de-passe-oublie');
    await page
      .getByRole('button', { name: fr.compte.motDePasseOublie.submit })
      .click();
    await expect(
      page.getByText(fr.compte.motDePasseOublie.emailRequiredError),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
