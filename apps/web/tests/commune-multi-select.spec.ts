import { expect, test, type Page } from '@playwright/test';
import { VEILLE_MAX_COMMUNES, type Commune } from '@mon-sinistre/contracts';
import { fr } from '../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { CHATEAU, NIMES, mockCommuneSearch, selectNimes } from './communes';
import { testApiBaseUrl } from './env';

// A chip holds the name next to its remove button, so no element's text is
// the name alone; the remove button is what the chip is addressable by.
const chipOf = (page: Page, commune: Commune) =>
  page.getByRole('button', {
    name: fr.veille.form.removeCommune(commune.name),
  });

test('a commune is found by name and by INSEE code, and is selected only with the keyboard', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto('/test-communes');

  // .focus() gives the field an initial keyboard position without a pointer
  // click; every interaction after that is a real key press, exercising the
  // same paths a keyboard-only user relies on.
  const input = page.getByLabel(fr.veille.form.communesLabel);
  await input.focus();
  await page.keyboard.type('Chateau');
  await expect(
    page.getByRole('option', { name: /Château-Thierry/ }),
  ).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(chipOf(page, CHATEAU)).toBeVisible();

  await page.keyboard.type('30189');
  const nimesOption = page.getByRole('option', { name: /Nîmes/ });
  await expect(nimesOption).toBeVisible();
  await page.keyboard.press('ArrowDown');
  // The highlight is asserted, not just the outcome: a search answer arriving
  // between the two key presses used to clear it, and Enter then selected
  // nothing while every other assertion here stayed green.
  await expect(nimesOption).toHaveAttribute('data-highlighted', '');
  await page.keyboard.press('Enter');
  await expect(chipOf(page, NIMES)).toBeVisible();

  await expect(page.getByTestId('selected-count')).toHaveText('2');
});

test('a selected commune is removed from the keyboard', async ({ page }) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto('/test-communes');

  await selectNimes(page);
  await expect(page.getByTestId('selected-count')).toHaveText('1');

  // The input is empty again after selection: Backspace here removes the
  // last chip, the platform's own keyboard shortcut for chip removal.
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('selected-count')).toHaveText('0');
  await expect(chipOf(page, NIMES)).toBeHidden();
});

test('the number of results and the empty state are announced to screen readers', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto('/test-communes');

  const input = page.getByLabel(fr.veille.form.communesLabel);
  await input.focus();
  await page.keyboard.type('Nimes');
  await expect(page.getByTestId('commune-search-status')).toHaveText(
    fr.veille.form.communesFound(1),
  );

  await page.keyboard.press('Control+a');
  await page.keyboard.type('Vaucanson');
  await expect(page.getByText(fr.veille.form.noCommuneFound)).toBeVisible();
});

test('a 21st commune cannot be added once the ceiling is reached', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto('/test-communes?preselected=20');
  await expect(page.getByTestId('selected-count')).toHaveText('20');
  await expect(
    page.getByText(fr.veille.form.maxCommunesReached(VEILLE_MAX_COMMUNES)),
  ).toBeVisible();

  await selectNimes(page);

  await expect(page.getByTestId('selected-count')).toHaveText('20');
  await expect(chipOf(page, NIMES)).toBeHidden();
});

test('a search still in flight neither claims « aucune commune » nor lets Enter select the previous results', async ({
  page,
}) => {
  // The « Chateau » answer is held until the test releases it, making the
  // pending-search window deterministic instead of timing-dependent.
  let releaseSearch = () => {};
  const searchHeld = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route(`${testApiBaseUrl}/communes**`, async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (q === 'Chateau') await searchHeld;
    await mockCommuneSearch(route);
  });
  await page.goto('/test-communes');

  const input = page.getByLabel(fr.veille.form.communesLabel);
  await input.focus();
  await page.keyboard.type('Nimes');
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();

  await page.keyboard.press('Control+a');
  await page.keyboard.type('Chateau');
  // keepPreviousData keeps the previous list on screen while the new answer
  // is pending: Nîmes is still shown, but it must be inert — Enter committing
  // it would subscribe the user to a commune unrelated to what they typed.
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();
  await expect(page.getByText(fr.veille.form.noCommuneFound)).toBeHidden();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-count')).toHaveText('0');

  releaseSearch();
  await expect(
    page.getByRole('option', { name: /Château-Thierry/ }),
  ).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(chipOf(page, CHATEAU)).toBeVisible();
  await expect(page.getByTestId('selected-count')).toHaveText('1');
});

// The shared axe suite walks the real pages (tests/pages.ts), and the test
// harness route is not one of them: the field is checked here, in the two
// states it actually has — list open, and chips selected.
test('the field is axe-clean with the list open and with chips selected', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto('/test-communes');

  await selectNimes(page);
  await expect(chipOf(page, NIMES)).toBeVisible();
  await expectNoAxeViolations(page);

  // The open list comes last: an axe pass takes the keyboard away from the
  // field, so anything typed after it would land nowhere.
  await page.keyboard.type('Chateau');
  await expect(
    page.getByRole('option', { name: /Château-Thierry/ }),
  ).toBeVisible();
  // While the list is open Base UI marks the rest of the page `aria-hidden`
  // without making it untabbable, which axe reports statically. The next test
  // shows the state is unreachable: Tab closes the list first.
  await expectNoAxeViolations(page, { disabledRules: ['aria-hidden-focus'] });
});

test('Tab closes the list and hands the page back', async ({ page }) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.goto('/test-communes');

  const input = page.getByLabel(fr.veille.form.communesLabel);
  await input.focus();
  await page.keyboard.type('Nimes');
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('option', { name: /Nîmes/ })).toBeHidden();
  await expect(page.getByRole('banner')).not.toHaveAttribute('aria-hidden');
});
