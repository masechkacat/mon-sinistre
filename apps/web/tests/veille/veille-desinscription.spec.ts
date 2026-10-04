import { expect, test } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { testApiBaseUrl } from '../support/env';
import { tokenConfirmScreenSuite } from '../support/token-confirm-screen';

const TOKEN = 'jeton-desinscription';
const PATH = `/veille/desinscription/confirmer?token=${TOKEN}`;

tokenConfirmScreenSuite({
  name: 'veille',
  path: PATH,
  token: TOKEN,
  endpoint: '/veille/desinscription',
  strings: fr.veille.desinscription.confirmer,
  testId: 'veille-desinscription-result',
});

test('a second visit through the same link shows the same screen without error, because the API is idempotent', async ({
  page,
}) => {
  // The API answers 204 unconditionally on every call — this mock stands in
  // for "already unsubscribed", the state a second visit finds.
  await page.route(`${testApiBaseUrl}/veille/desinscription**`, (route) =>
    route.fulfill({ status: 204 }),
  );

  await page.goto(PATH);
  await page
    .getByRole('button', {
      name: fr.veille.desinscription.confirmer.unsubscribeButton,
    })
    .click();

  await expect(
    page.getByRole('heading', {
      name: fr.veille.desinscription.confirmer.done.title,
    }),
  ).toBeVisible();
  await expect(page.getByTestId('request-error')).toHaveCount(0);
});
