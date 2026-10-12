import { expect, test, type Page } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { ESPACE_PERSONNEL_PATH, LOGIN_PATH } from '../../src/lib/api/session';
import { gotoPage, home } from '../support/pages';
import { mockNoSession, mockSession } from '../support/session-mock';

const copy = fr.layout;

const mainNav = (page: Page) =>
  page.getByRole('navigation', { name: copy.mainNav });

test('without a session the header offers the login', async ({ page }) => {
  await mockNoSession(page);
  await gotoPage(page, home);

  await expect(
    mainNav(page).getByRole('link', { name: copy.login }),
  ).toHaveAttribute('href', LOGIN_PATH);
});

test('with a session the header leads to the espace personnel in one click', async ({
  page,
}) => {
  await mockSession(page).install();
  await gotoPage(page, home);

  await mainNav(page).getByRole('link', { name: copy.espace }).click();

  await expect(page).toHaveURL(ESPACE_PERSONNEL_PATH);
  await expect(page.getByTestId('espace-personnel-content')).toBeVisible();
  // One door, not two: the login is gone once the session answers.
  await expect(
    mainNav(page).getByRole('link', { name: copy.login }),
  ).toHaveCount(0);
});
