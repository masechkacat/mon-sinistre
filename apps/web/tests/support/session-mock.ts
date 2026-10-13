import type { Page, Route as PlaywrightRoute } from '@playwright/test';
import { REFRESH_PATH } from '../../src/lib/api/session';
import { testApiBaseUrl } from './env';

const refreshUrl = `${testApiBaseUrl}${REFRESH_PATH}`;

export const ACCESS_TOKEN = 'jeton-acces-test';

/** The refusal of a `refresh_token` that is absent, expired or revoked. */
const NO_SESSION = {
  status: 401,
  contentType: 'application/json',
  body: '{}',
} as const;

/**
 * No session at all. Mocked rather than left unrouted: nothing listens on
 * `testApiBaseUrl` during `test:web` (env.ts), and a failed connection would
 * prove the same branch by accident instead of by the API's answer.
 */
export function mockNoSession(page: Page) {
  return page.route(refreshUrl, (route: PlaywrightRoute) =>
    route.fulfill(NO_SESSION),
  );
}

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
      await page.route(refreshUrl, (route: PlaywrightRoute) => {
        if (loggedOut) return route.fulfill(NO_SESSION);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accessToken: ACCESS_TOKEN }),
        });
      });
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
