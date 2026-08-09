import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { testApiBaseUrl } from './env';

test('the app renders through the connected QueryClientProvider', async ({
  page,
}) => {
  const response = await page.goto('/test-requete');
  expect(response?.status()).toBe(200);
  // No API is running on testApiBaseUrl during this suite, so the query
  // settling into "error" (rather than staying blank or crashing the page)
  // is what proves useQuery ran inside a connected provider.
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

test('axe: the request-error state is clean', async ({ page }) => {
  await page.route(`${testApiBaseUrl}/**`, (route) => route.abort());
  await page.goto('/test-requete');
  await expect(page.getByTestId('request-error')).toBeVisible();
  await expectNoAxeViolations(page);
});
