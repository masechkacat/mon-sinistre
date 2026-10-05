import { expect, test, type Locator, type Page } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import {
  contrastRatio,
  paintedColours,
  roles,
  toRgb,
} from '../support/contrast';
import { testApiBaseUrl } from '../support/env';
import { mockSession } from '../support/session-mock';
import { SINISTRE_ID_1, sinistreFixture } from '../support/sinistres';

const palette = roles();

const SHEET = "[data-surface='papier']";
const onSheet = (selector: string) => `${SHEET} ${selector}`;

const resolved = (page: Page, variable: string) =>
  page
    .locator(SHEET)
    .first()
    .evaluate(
      (element, name) =>
        getComputedStyle(element).getPropertyValue(name).trim(),
      variable,
    );

// The list of dossiers, not `/espace-personnel` of the plan: a sheet has to be
// on screen next to text that is not on one, and the list is the page where a
// `Card` and the page title outside it coexist.
async function gotoListe(page: Page, colorScheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme });
  await mockSession(page).install();
  await page.route(`${testApiBaseUrl}/sinistres`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([sinistreFixture()]),
    }),
  );
  await page.goto('/sinistres');
  await expect(
    page.getByTestId(`sinistre-card-${SINISTRE_ID_1}`),
  ).toBeVisible();
}

const newSinistreButton = (page: Page) =>
  page.getByRole('link', { name: fr.sinistres.liste.newSinistre });

test('dark theme: the sheet keeps its ink, the ground gets « sur fond »', async ({
  page,
}) => {
  const { dark } = palette;
  await gotoListe(page, 'dark');

  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS(
    'color',
    toRgb(dark['texte-sur-fond']),
  );
  await expect(page.getByText(fr.sinistres.liste.lead)).toHaveCSS(
    'color',
    toRgb(dark['secondaire-sur-fond']),
  );
  await expect(page.locator(onSheet('h2'))).toHaveCSS(
    'color',
    toRgb(dark.encre),
  );
  await expect(page.locator(onSheet('.text-muted-foreground'))).toHaveCSS(
    'color',
    toRgb(dark.secondaire),
  );

  await expect(newSinistreButton(page)).toHaveCSS(
    'background-color',
    toRgb(dark['texte-sur-fond']),
  );
  await expect(newSinistreButton(page)).toHaveCSS('color', toRgb(dark.encre));
  // No default button sits on a sheet yet (the dossier card carries an
  // `outline` link), so what `bg-primary` would read there is asserted on the
  // sheet itself — the pair the paper button is painted with.
  expect(await resolved(page, '--primary')).toBe(dark.petrole);
  expect(await resolved(page, '--primary-foreground')).toBe(dark.papier);
});

test('light theme: the sheet rule changes nothing', async ({ page }) => {
  const { light } = palette;
  await gotoListe(page, 'light');

  for (const ink of [
    page.getByRole('heading', { level: 1 }),
    page.locator(onSheet('h2')),
  ]) {
    await expect(ink).toHaveCSS('color', toRgb(light.encre));
  }
  for (const secondary of [
    page.getByText(fr.sinistres.liste.lead),
    page.locator(onSheet('.text-muted-foreground')),
  ]) {
    await expect(secondary).toHaveCSS('color', toRgb(light.secondaire));
  }

  await expect(newSinistreButton(page)).toHaveCSS(
    'background-color',
    toRgb(light.petrole),
  );
  await expect(newSinistreButton(page)).toHaveCSS('color', toRgb(light.papier));
});

const expectHoveredAA = async (control: Locator) => {
  await control.hover();
  // `transition-all` fades the hover ground in: measured mid-way, the resting
  // colours would pass for the hovered ones.
  await control.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const { background, text } = await paintedColours(control);
  expect(contrastRatio(background, text)).toBeGreaterThanOrEqual(4.5);
};

test('dark theme: a hovered outline button keeps AA text contrast on the ground and on a sheet', async ({
  page,
}) => {
  await gotoListe(page, 'dark');
  await expectHoveredAA(
    page.getByRole('link', { name: fr.sinistres.liste.viewLink }),
  );

  await page.route(`${testApiBaseUrl}/auth/me`, (route) => route.abort());
  await page.goto('/espace-personnel');
  await expectHoveredAA(
    page.getByRole('link', { name: fr.compte.espacePersonnel.sinistresLink }),
  );
});
