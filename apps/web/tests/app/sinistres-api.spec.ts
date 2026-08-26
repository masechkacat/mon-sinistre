import { expect, test } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { testApiBaseUrl } from '../support/env';
import { mockSession } from '../support/session-mock';

// Exercises src/lib/api/sinistres.ts through the test-only /test-sinistres
// route (test-sinistres.tsx). The guard's own redirect-on-401 behaviour is
// already proven by tests/auth/session.spec.ts against useSessionGuard
// directly — not repeated here.

test('a network failure shows the French error message, not a blank screen', async ({
  page,
}) => {
  await mockSession(page).install();
  await page.route(`${testApiBaseUrl}/sinistres`, (route) => route.abort());

  await page.goto('/test-sinistres');

  const alert = page.getByTestId('request-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(fr.requestError.title);
  await expect(alert).toContainText(fr.requestError.description);
});

test('a signed-in session lists the caller’s sinistres', async ({ page }) => {
  await mockSession(page).install();
  await page.route(`${testApiBaseUrl}/sinistres`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '11111111-1111-1111-1111-111111111111',
          communeCode: '30189',
          risque: 'INONDATION',
          eventDate: '2026-06-15',
          arreteEntryId: null,
          declarationDate: null,
          status: 'AVANT_ARRETE',
          createdAt: '2026-06-16T08:00:00.000Z',
        },
      ]),
    }),
  );

  await page.goto('/test-sinistres');

  await expect(page.getByTestId('sinistres-count')).toHaveText('1');
});
