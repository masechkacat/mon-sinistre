import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';
import { mockSession } from './session-mock';

test('a session with a valid refresh cookie survives a page reload', async ({
  page,
}) => {
  await mockSession(page).install();

  await page.goto('/espace-personnel');
  await expect(page.getByTestId('espace-personnel-content')).toBeVisible();

  // The in-memory access token does not survive a reload — only the silent
  // refresh against the (still valid) cookie does.
  await page.reload();
  await expect(page.getByTestId('espace-personnel-content')).toBeVisible();
});

test('no session redirects to the login page instead of showing protected content', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/auth/refresh`, (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );

  await page.goto('/espace-personnel');

  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByTestId('espace-personnel-content')).toHaveCount(0);
});

test('logging out makes the protected page unreachable, including through the browser back button (bfcache)', async ({
  page,
}) => {
  await mockSession(page).install();

  await page.goto('/espace-personnel');
  await expect(page.getByTestId('espace-personnel-content')).toBeVisible();

  await page.getByRole('button', { name: fr.session.logout }).click();
  await expect(page).toHaveURL(/\/connexion$/);

  // Whether Chromium actually restores the previous document from bfcache
  // or reloads it in full, the observable contract is identical either way:
  // /espace-personnel re-checks the session — via the mount effect on a
  // fresh load, via the pageshow listener on a bfcache restore
  // (use-session-guard.ts) — and the mocked refresh above now answers 401
  // on both paths because logout flipped it.
  await page.goBack();
  await expect(page.getByTestId('espace-personnel-content')).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the authenticated session state is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await mockSession(page).install();
    await page.goto('/espace-personnel');
    await expect(page.getByTestId('espace-personnel-content')).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
