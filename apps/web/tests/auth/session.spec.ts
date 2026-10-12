import { expect, test } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { testApiBaseUrl } from '../support/env';
import { VALID_PASSWORD as PASSWORD } from '../support/form';
import {
  LOGIN_PATH,
  clearAccessToken,
  endSession,
  loginPathWithNext,
  setAccessToken,
  subscribeAccessToken,
} from '../../src/lib/api/session';
import { withMockApi } from '../support/mock-api';
import {
  ACCESS_TOKEN,
  mockNoSession,
  mockSession,
} from '../support/session-mock';

const EMAIL = 'sinistre@example.fr';
const REFRESH_COOKIE = 'refresh_token=jeton-refresh-test';

/** The test-only page mounting two `useSession` consumers side by side. */
const TWO_CONSUMERS_PATH = '/test-session';

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
  await mockNoSession(page);

  await page.goto('/espace-personnel');

  await expect(page).toHaveURL(loginPathWithNext('/espace-personnel'));
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

test('logging in stores the refresh cookie, and the silent refresh sends it back', async ({
  page,
}) => {
  // The one test that does not take the session for granted: it checks the
  // browser actually keeps and returns the `refresh_token` cookie. The API is
  // a different origin, so a request sent without `credentials: 'include'`
  // has its `Set-Cookie` dropped — a session that works until the first
  // reload and dies there, which every mocked-refresh test above would still
  // report as green.
  await page.route(`${testApiBaseUrl}/auth/login`, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': `${REFRESH_COOKIE}; Path=/; HttpOnly; SameSite=Lax`,
      },
      body: JSON.stringify({ accessToken: ACCESS_TOKEN }),
    }),
  );
  let refreshRequestCookies: string | undefined;
  await page.route(`${testApiBaseUrl}/auth/refresh`, (route) => {
    refreshRequestCookies = route.request().headers().cookie;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: ACCESS_TOKEN }),
    });
  });

  await page.goto('/connexion');
  await page.getByLabel(fr.compte.connexion.emailLabel).fill(EMAIL);
  await page.getByLabel(fr.compte.connexion.passwordLabel).fill(PASSWORD);
  await page.getByRole('button', { name: fr.compte.connexion.submit }).click();
  await expect(page.getByTestId('espace-personnel-content')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('espace-personnel-content')).toBeVisible();
  expect(refreshRequestCookies).toContain(REFRESH_COOKIE);
});

/**
 * `endSession` leaves the client app through `window.location` (session.ts),
 * and the test process has no browser to leave: the departure is recorded
 * instead, so the call runs to its end.
 */
function stubNavigation() {
  const left: string[] = [];
  Object.defineProperty(globalThis, 'window', {
    value: { location: { assign: (path: string) => left.push(path) } },
    configurable: true,
  });
  return { left, restore: () => Reflect.deleteProperty(globalThis, 'window') };
}

test('logging out revokes the session at the API and tells the subscribers the token is gone', async () => {
  // No page: the token subscription is what a session widget renders from
  // (use-session.ts), so the module is called from the test process and the
  // logout is answered by a listener on the API address (support/mock-api.ts).
  const heard: (string | null)[] = [];
  const unsubscribe = subscribeAccessToken((token) => heard.push(token));
  const navigation = stubNavigation();
  try {
    await withMockApi(async (received) => {
      setAccessToken(ACCESS_TOKEN);
      await endSession();
      expect(received()?.url).toBe('/auth/logout');
    });
    expect(heard).toEqual([ACCESS_TOKEN, null]);
    expect(navigation.left).toEqual([LOGIN_PATH]);

    unsubscribe();
    setAccessToken(ACCESS_TOKEN);
    expect(heard).toEqual([ACCESS_TOKEN, null]);
  } finally {
    unsubscribe();
    clearAccessToken();
    navigation.restore();
  }
});

test('one silent refresh answers every session consumer on the page', async ({
  page,
}) => {
  await mockSession(page).install();
  // Counted through the request event rather than a second page.route on the
  // same address: the later handler wins, and it would be this counter
  // instead of the mock answering the refresh.
  let refreshRequests = 0;
  page.on('request', (request) => {
    if (request.url() === `${testApiBaseUrl}/auth/refresh`)
      refreshRequests += 1;
  });

  await page.goto(TWO_CONSUMERS_PATH);

  await expect(page.getByTestId('session-status-a')).toHaveText(
    'authenticated',
  );
  await expect(page.getByTestId('session-status-b')).toHaveText(
    'authenticated',
  );
  expect(refreshRequests).toBe(1);
});

test('a visitor without a session is told so instead of being left checking', async ({
  page,
}) => {
  await mockNoSession(page);

  await page.goto(TWO_CONSUMERS_PATH);

  await expect(page.getByTestId('session-status-a')).toHaveText('anonymous');
  await expect(page.getByTestId('session-status-b')).toHaveText('anonymous');
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
