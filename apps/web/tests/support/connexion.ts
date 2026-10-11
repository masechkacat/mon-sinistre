import type { Page } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { testApiBaseUrl } from './env';
import { ACCESS_TOKEN } from './session-mock';

/** Shared by every spec that logs in through the form (connexion, suivant). */
export const LOGIN_EMAIL = 'sinistre@example.fr';

/** `POST /auth/login` accepted; gives back the bodies it was sent. */
export async function mockLogin(page: Page) {
  const sent: unknown[] = [];
  await page.route(`${testApiBaseUrl}/auth/login`, (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}'));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: ACCESS_TOKEN }),
    });
  });
  return sent;
}

export async function fillLoginForm(
  page: Page,
  { email, password }: { email: string; password: string },
) {
  await page.getByLabel(fr.compte.connexion.emailLabel).fill(email);
  await page.getByLabel(fr.compte.connexion.passwordLabel).fill(password);
  await page.getByRole('button', { name: fr.compte.connexion.submit }).click();
}
