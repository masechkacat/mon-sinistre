import {
  expect,
  test,
  type Page,
  type Route as PlaywrightRoute,
} from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { deferred } from '../support/deferred';
import { testApiBaseUrl } from '../support/env';
import { mockSession } from '../support/session-mock';

const EMAIL = 'sinistre@example.fr';

interface AccountMockOptions {
  /** State the first `GET /auth/me` reports; `PATCH /rappels` then moves it. */
  remindersEnabled?: boolean;
  /** Holds every `PATCH /rappels` until the returned promise resolves — the
   * only way to read the pending label, which lives between click and answer. */
  holdRappels?: Promise<void>;
  /** Makes `PATCH /rappels` unreachable: the branch the French error message
   * belongs to. */
  rappelsUnreachable?: boolean;
}

/** GET answers the signed-in account's email and reminders state; DELETE
 * answers success and counts calls; `PATCH /rappels` records what was asked
 * and moves the state the next GET reports, so the section refetched after
 * the mutation sees the new value — shared by every test below, each reading
 * only the part of `state` it is about. */
function mockCurrentUser(page: Page, options: AccountMockOptions = {}) {
  const state = {
    deleteCalls: 0,
    remindersEnabled: options.remindersEnabled ?? true,
    rappelsCalls: [] as { method: string; enabled: boolean }[],
  };
  return {
    state,
    install: async () => {
      await page.route(
        `${testApiBaseUrl}/auth/me`,
        (route: PlaywrightRoute) => {
          if (route.request().method() === 'DELETE') {
            state.deleteCalls += 1;
            return route.fulfill({ status: 204 });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              email: EMAIL,
              remindersEnabled: state.remindersEnabled,
            }),
          });
        },
      );
      await page.route(
        `${testApiBaseUrl}/rappels`,
        async (route: PlaywrightRoute) => {
          if (options.rappelsUnreachable) return route.abort();
          const body = JSON.parse(route.request().postData() ?? '{}') as {
            enabled: boolean;
          };
          state.rappelsCalls.push({
            method: route.request().method(),
            enabled: body.enabled,
          });
          state.remindersEnabled = body.enabled;
          await options.holdRappels;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
          });
        },
      );
    },
  };
}

const rappels = fr.compte.espacePersonnel.rappels;

test('shows the account holder’s email', async ({ page }) => {
  await mockSession(page).install();
  await mockCurrentUser(page).install();

  await page.goto('/espace-personnel');

  await expect(page.getByTestId('espace-personnel-email')).toContainText(EMAIL);
});

test('reminders left on are shown as on, and the button offers to turn them off', async ({
  page,
}) => {
  await mockSession(page).install();
  await mockCurrentUser(page).install();

  await page.goto('/espace-personnel');

  await expect(
    page.getByRole('heading', { name: rappels.heading }),
  ).toBeVisible();
  const etat = page.getByTestId('rappels-etat');
  await expect(etat).toHaveText(rappels.enabled);
  // The sentence is the live region itself, so the changes below are read out
  // while arriving on the page stays silent.
  await expect(etat).toHaveAttribute('role', 'status');
  await expect(
    page.getByRole('button', { name: rappels.disable }),
  ).toBeVisible();
});

test('turning reminders off sends the opposite value and flips the section', async ({
  page,
}) => {
  await mockSession(page).install();
  const held = deferred();
  const account = mockCurrentUser(page, { holdRappels: held.promise });
  await account.install();

  await page.goto('/espace-personnel');
  await page.getByRole('button', { name: rappels.disable }).click();

  await expect(
    page.getByRole('button', { name: rappels.updating }),
  ).toBeVisible();
  held.release();

  await expect(page.getByTestId('rappels-etat')).toHaveText(rappels.disabled);
  await expect(
    page.getByRole('button', { name: rappels.enable }),
  ).toBeVisible();
  expect(account.state.rappelsCalls).toEqual([
    { method: 'PATCH', enabled: false },
  ]);
});

test('reminders turned off by the mail link are shown as off and come back with one keypress', async ({
  page,
}) => {
  await mockSession(page).install();
  const account = mockCurrentUser(page, { remindersEnabled: false });
  await account.install();

  await page.goto('/espace-personnel');
  await expect(page.getByTestId('rappels-etat')).toHaveText(rappels.disabled);

  const button = page.getByRole('button', { name: rappels.enable });
  // Reached by tabbing rather than clicked: the control has to be on the
  // keyboard path of the page, not merely focusable once addressed.
  for (let i = 0; i < 25 && !(await button.evaluate(isFocused)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('rappels-etat')).toHaveText(rappels.enabled);
  expect(account.state.rappelsCalls).toEqual([
    { method: 'PATCH', enabled: true },
  ]);
  // The button disables itself while the request is in flight; focus has to
  // stay on it, or the keyboard user is dropped to <body> mid-action.
  await expect(
    page.getByRole('button', { name: rappels.disable }),
  ).toBeFocused();
});

const isFocused = (node: Element) => node === document.activeElement;

test('an unreachable API leaves the reminders state alone and shows the French error message', async ({
  page,
}) => {
  await mockSession(page).install();
  await mockCurrentUser(page, { rappelsUnreachable: true }).install();

  await page.goto('/espace-personnel');
  await page.getByRole('button', { name: rappels.disable }).click();

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
  await expect(page.getByTestId('rappels-etat')).toHaveText(rappels.enabled);
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
  test(`axe: the page with the reminders section and the delete-account confirmation panel is clean — theme ${colorScheme}`, async ({
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
    // Both sections at once rather than a pass each: the reminders section is
    // on screen here too, and axe reads the whole document anyway.
    await expect(page.getByTestId('rappels-etat')).toBeVisible();

    await expectNoAxeViolations(page);
  });
}
