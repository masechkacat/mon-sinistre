import { expect, test, type Route as PlaywrightRoute } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';

const ACCESS_TOKEN = 'jeton-acces-test';

/**
 * Stands in for the real API's session pair (apps/api/src/auth): refresh
 * succeeds while the session is live and starts answering 401 the moment
 * logout is called — same contract as a revoked `refresh_token` cookie.
 */
function mockSession(page: import('@playwright/test').Page) {
  let loggedOut = false;
  return {
    async install() {
      await page.route(
        `${testApiBaseUrl}/auth/refresh`,
        (route: PlaywrightRoute) => {
          if (loggedOut) {
            return route.fulfill({
              status: 401,
              contentType: 'application/json',
              body: '{}',
            });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ accessToken: ACCESS_TOKEN }),
          });
        },
      );
      await page.route(
        `${testApiBaseUrl}/auth/logout`,
        (route: PlaywrightRoute) => {
          loggedOut = true;
          return route.fulfill({
            status: 204,
            contentType: 'application/json',
            body: '',
          });
        },
      );
    },
  };
}

test('a session with a valid refresh cookie survives a page reload', async ({
  page,
}) => {
  await mockSession(page).install();

  await page.goto('/test-session');
  await expect(page.getByTestId('protected-content')).toHaveText(
    fr.session.loggedIn,
  );

  // The in-memory access token does not survive a reload — only the silent
  // refresh against the (still valid) cookie does.
  await page.reload();
  await expect(page.getByTestId('protected-content')).toHaveText(
    fr.session.loggedIn,
  );
});

test('no session redirects to the login page instead of showing protected content', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/refresh`, (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );

  await page.goto('/test-session');

  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByTestId('protected-content')).toHaveCount(0);
});

test('logging out makes the protected page unreachable, including through the browser back button (bfcache)', async ({
  page,
}) => {
  await mockSession(page).install();

  await page.goto('/test-session');
  await expect(page.getByTestId('protected-content')).toBeVisible();

  await page.getByRole('button', { name: fr.session.logout }).click();
  await expect(page).toHaveURL(/\/connexion$/);

  // Whether Chromium actually restores the previous document from bfcache
  // or reloads it in full (this route's force-dynamic response carries the
  // same no-store header as the project's other test-only routes, which
  // tends to disable bfcache), the observable contract is identical either
  // way: /test-session re-checks the session — via the mount effect on a
  // fresh load, via the pageshow listener on a bfcache restore
  // (use-session-guard.ts) — and the mocked refresh above now answers 401
  // on both paths because logout flipped it.
  await page.goBack();
  await expect(page.getByTestId('protected-content')).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the authenticated session state is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await mockSession(page).install();
    await page.goto('/test-session');
    await expect(page.getByTestId('protected-content')).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
