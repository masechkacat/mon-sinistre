import { expect, test } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { testApiBaseUrl } from '../support/env';
import { mockSession } from '../support/session-mock';

const SINISTRE_ID_1 = '11111111-1111-1111-1111-111111111111';
const SINISTRE_ID_2 = '22222222-2222-2222-2222-222222222222';

function sinistreSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SINISTRE_ID_1,
    communeCode: '30189',
    risque: 'INONDATION',
    eventDate: '2026-06-15',
    arreteEntryId: null,
    declarationDate: null,
    status: 'AVANT_ARRETE',
    createdAt: '2026-06-16T08:00:00.000Z',
    ...overrides,
  };
}

test('the empty state explains what to do when the caller has no sinistre yet', async ({
  page,
}) => {
  await mockSession(page).install();
  await page.route(`${testApiBaseUrl}/sinistres`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  await page.goto('/sinistres');

  await expect(
    page.getByText(fr.sinistres.liste.empty.description),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: fr.sinistres.liste.newSinistre }),
  ).toHaveAttribute('href', '/sinistres/nouveau');
});

test('lists two of the caller’s sinistres, each with its status in words and its own link', async ({
  page,
}) => {
  await mockSession(page).install();
  await page.route(`${testApiBaseUrl}/sinistres`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        sinistreSummary({ id: SINISTRE_ID_1, status: 'AVANT_ARRETE' }),
        sinistreSummary({
          id: SINISTRE_ID_2,
          risque: 'SECHERESSE',
          status: 'ARRETE_PUBLIE',
        }),
      ]),
    }),
  );

  await page.goto('/sinistres');

  const card1 = page.getByTestId(`sinistre-card-${SINISTRE_ID_1}`);
  const card2 = page.getByTestId(`sinistre-card-${SINISTRE_ID_2}`);
  await expect(card1.getByText(fr.sinistres.statut.AVANT_ARRETE)).toBeVisible();
  await expect(
    card2.getByText(fr.sinistres.statut.ARRETE_PUBLIE),
  ).toBeVisible();

  await expect(
    card1.getByRole('link', { name: fr.sinistres.liste.viewLink }),
  ).toHaveAttribute('href', `/sinistres/${SINISTRE_ID_1}`);
  await expect(
    card2.getByRole('link', { name: fr.sinistres.liste.viewLink }),
  ).toHaveAttribute('href', `/sinistres/${SINISTRE_ID_2}`);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the sinistres list is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await mockSession(page).install();
    await page.route(`${testApiBaseUrl}/sinistres`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([sinistreSummary()]),
      }),
    );

    await page.goto('/sinistres');
    await expect(
      page.getByTestId(`sinistre-card-${SINISTRE_ID_1}`),
    ).toBeVisible();

    await expectNoAxeViolations(page);
  });
}
