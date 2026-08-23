import type { Page, Route as PlaywrightRoute } from '@playwright/test';
import { testApiBaseUrl } from './env';

export const ACCESS_TOKEN = 'jeton-acces-test';

/**
 * Stands in for the real API's session pair (apps/api/src/auth): refresh
 * succeeds while the session is live and starts answering 401 the moment
 * logout is called — same contract as a revoked `refresh_token` cookie.
 * Shared by session.spec.ts and espace-personnel.spec.ts — both need an
 * authenticated session before they can reach the protected page.
 */
export function mockSession(page: Page) {
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
