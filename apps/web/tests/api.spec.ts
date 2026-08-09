import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';

test('the app renders through the connected QueryClientProvider', async ({
  page,
}) => {
  // The route is aborted rather than left to fail on its own: "nothing
  // listens on testApiBaseUrl" is a property of the machine, and anything
  // bound to that port would make the query succeed or hang instead.
  await page.route(`${testApiBaseUrl}/**`, (route) => route.abort());
  const response = await page.goto('/test-requete');
  expect(response?.status()).toBe(200);
  // The query settling into "error" (rather than staying blank or crashing
  // the page) is what proves useQuery ran inside a connected provider.
  await expect(page.getByTestId('query-status')).toHaveText('error');
});

test('the base API address comes from the environment', async ({ page }) => {
  await page.goto('/test-requete');
  await expect(page.getByTestId('api-base-url')).toHaveText(testApiBaseUrl);
});

test('a failed request shows the French error message, not a blank screen', async ({
  page,
}) => {
  // Explicit abort (rather than relying on "no API running") pins the
  // scenario the plan asks for: a request that reaches the network and
  // fails, not one that never leaves the page.
  await page.route(`${testApiBaseUrl}/**`, (route) => route.abort());
  await page.goto('/test-requete');
  // Next.js's own route announcer (#__next-route-announcer__) also carries
  // role="alert", so the component is located by testid and its role is
  // asserted separately.
  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
  await expect(alert).toContainText(fr.requestError.description);
});

test('an HTTP error response shows the same French message', async ({
  page,
}) => {
  // The other failure tests never reach the server, so they leave apiFetch's
  // `!response.ok` branch untested: a wrapper that resolved on a 500 would
  // keep them green while the user got a blank screen.
  await page.route(`${testApiBaseUrl}/**`, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/test-requete');
  await expect(page.getByTestId('request-error')).toContainText(
    fr.requestError.title,
  );
});

// Both themes, like the shared suite in a11y.spec.ts: the error state is
// reached through a query failure rather than a URL, so it is not in the
// pages registry that suite iterates, and a dark-theme contrast regression in
// the alert would otherwise ship green.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the request-error state is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/**`, (route) => route.abort());
    await page.goto('/test-requete');
    await expect(page.getByTestId('request-error')).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
