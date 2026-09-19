import { expect, test } from '@playwright/test';
import { communeLabel } from '../../src/lib/commune-label';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import {
  CHATEAU,
  NIMES,
  holdCommuneSearch,
  mockCommuneSearch,
} from '../support/communes';
import { testApiBaseUrl } from '../support/env';

test('a commune is found and selected with the keyboard, and the selection is announced', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto('/test-commune-select');

  const input = page.getByLabel('Commune');
  await input.focus();
  await page.keyboard.type('Chateau');
  const option = page.getByRole('option', { name: /Château-Thierry/ });
  await expect(option).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await expect(option).toHaveAttribute('data-highlighted', '');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('selected-code')).toHaveText(CHATEAU.codeInsee);
  await expect(page.getByTestId('commune-selected-status')).toHaveText(
    fr.commune.selected(`${CHATEAU.name} (${CHATEAU.departementName})`),
  );
});

test('a second search replaces the selection from the keyboard', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto('/test-commune-select');

  const input = page.getByLabel('Commune');
  await input.focus();
  await page.keyboard.type('Chateau');
  await expect(
    page.getByRole('option', { name: /Château-Thierry/ }),
  ).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-code')).toHaveText(CHATEAU.codeInsee);

  await page.keyboard.press('Control+a');
  await page.keyboard.type('Nimes');
  const nimesOption = page.getByRole('option', { name: /Nîmes/ });
  await expect(nimesOption).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(nimesOption).toHaveAttribute('data-highlighted', '');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('selected-code')).toHaveText(NIMES.codeInsee);
});

test('the chosen commune is not searched again as if it were a query', async ({
  page,
}) => {
  const queries: string[] = [];
  await page.route(`${testApiBaseUrl}/communes**`, async (route) => {
    queries.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    await mockCommuneSearch(route);
  });
  await page.goto('/test-commune-select');

  const input = page.getByLabel('Commune');
  await input.focus();
  await page.keyboard.type('Nimes');
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-code')).toHaveText(NIMES.codeInsee);

  // A fixed wait, not a poll: the assertion is that something never happens,
  // and the debounce window (250 ms) is when it would. The selected label is
  // no commune's name, so searching it answers « aucune commune » over a
  // choice the person just made.
  await page.waitForTimeout(500);
  expect(queries).not.toContain(communeLabel(NIMES));
  await expect(page.getByText(fr.commune.noneFound)).toBeHidden();
});

test('a search still in flight does not let Enter commit the previous result', async ({
  page,
}) => {
  // Here the stake is higher than in the multi-select's own in-flight spec:
  // the committed commune is what the arrêté match and the declaration
  // deadline are computed from.
  const { release } = await holdCommuneSearch(page, 'Chateau');
  await page.goto('/test-commune-select');

  const input = page.getByLabel('Commune');
  await input.focus();
  await page.keyboard.type('Nimes');
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();

  await page.keyboard.press('Control+a');
  await page.keyboard.type('Chateau');
  // keepPreviousData keeps Nîmes on screen while the new answer is pending;
  // Enter on it must not commit a commune unrelated to what is typed.
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-code')).toHaveText('');

  release();
  await expect(
    page.getByRole('option', { name: /Château-Thierry/ }),
  ).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-code')).toHaveText(CHATEAU.codeInsee);
});

test('no result below the search leaves nothing selected', async ({ page }) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto('/test-commune-select');

  const input = page.getByLabel('Commune');
  await input.focus();
  await page.keyboard.type('Vaucanson');
  await expect(page.getByText(fr.commune.noneFound)).toBeVisible();
  await expect(page.getByTestId('selected-code')).toHaveText('');
});

test('the field is axe-clean with the list open and with a commune selected', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto('/test-commune-select');

  const input = page.getByLabel('Commune');
  await input.focus();
  await page.keyboard.type('Nimes');
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-code')).toHaveText(NIMES.codeInsee);
  await expectNoAxeViolations(page);
});
