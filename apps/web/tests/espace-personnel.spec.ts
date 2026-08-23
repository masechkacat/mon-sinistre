import {
  expect,
  test,
  type Page,
  type Route as PlaywrightRoute,
} from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';
import { mockSession } from './session-mock';

const EMAIL = 'sinistre@example.fr';

/** GET answers the signed-in account's email; DELETE answers success and
 * counts calls — shared by every test below so only the confirm-flow test
 * needs to read `deleteCalls`. */
function mockCurrentUser(page: Page) {
  const state = { deleteCalls: 0 };
  return {
    state,
    install: () =>
      page.route(`${testApiBaseUrl}/auth/me`, (route: PlaywrightRoute) => {
        if (route.request().method() === 'DELETE') {
          state.deleteCalls += 1;
          return route.fulfill({ status: 204 });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ email: EMAIL }),
        });
      }),
  };
}

test('shows the account holder’s email', async ({ page }) => {
  await mockSession(page).install();
  await mockCurrentUser(page).install();

  await page.goto('/espace-personnel');

  await expect(page.getByTestId('espace-personnel-email')).toContainText(EMAIL);
});

test('deleting the account requires an explicit confirmation before the request is sent', async ({
  page,
}) => {
  await mockSession(page).install();
  const currentUser = mockCurrentUser(page);
  await currentUser.install();

  await page.goto('/espace-personnel');
  await page
    .getByRole('button', {
      name: fr.compte.espacePersonnel.deleteAccount.button,
    })
    .click();

  await expect(
    page.getByText(fr.compte.espacePersonnel.deleteAccount.warning.title),
  ).toBeVisible();
  expect(currentUser.state.deleteCalls).toBe(0);

  await page
    .getByRole('button', {
      name: fr.compte.espacePersonnel.deleteAccount.cancel,
    })
    .click();

  expect(currentUser.state.deleteCalls).toBe(0);
  const trigger = page.getByRole('button', {
    name: fr.compte.espacePersonnel.deleteAccount.button,
  });
  await expect(trigger).toBeVisible();
  // Disclosure pattern: closing the panel returns focus to the control that
  // opened it, so keyboard/screen-reader users are not stranded on <body>.
  await expect(trigger).toBeFocused();
});

test('confirming deletion sends the request and lands on a public page', async ({
  page,
}) => {
  await mockSession(page).install();
  const currentUser = mockCurrentUser(page);
  await currentUser.install();

  await page.goto('/espace-personnel');
  await page
    .getByRole('button', {
      name: fr.compte.espacePersonnel.deleteAccount.button,
    })
    .click();
  await page
    .getByRole('button', {
      name: fr.compte.espacePersonnel.deleteAccount.confirm,
    })
    .click();

  await expect(page).toHaveURL(/\/compte-supprime$/);
  await expect(
    page.getByRole('heading', { name: fr.compte.compteSupprime.page.title }),
  ).toBeVisible();
  expect(currentUser.state.deleteCalls).toBe(1);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the delete-account confirmation panel is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await mockSession(page).install();
    await mockCurrentUser(page).install();

    await page.goto('/espace-personnel');
    await page
      .getByRole('button', {
        name: fr.compte.espacePersonnel.deleteAccount.button,
      })
      .click();
    await expect(
      page.getByText(fr.compte.espacePersonnel.deleteAccount.warning.title),
    ).toBeVisible();

    await expectNoAxeViolations(page);
  });
}
