import { expect, test } from '@playwright/test';
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
