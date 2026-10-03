import { expect, test, type Page } from '@playwright/test';
import {
  REFERENCE_DATA_STALE_AFTER_MONTHS,
  StepAnchor,
  StepStatus,
} from '@mon-sinistre/contracts';
import { dossierTitle } from '../../src/lib/dossier-title';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { testApiBaseUrl } from '../support/env';
import { mockSession } from '../support/session-mock';
import {
  SINISTRE_ID_1,
  sinistreFixture,
  stepFixture as step,
} from '../support/sinistres';

const SOURCE = {
  url: 'https://www.legifrance.gouv.fr/codes/id/LEGIARTI000006792617',
  verifiedAt: '2026-08-18',
  possiblyOutdated: false,
};

// Five steps in template order: one overdue, one due soon (the nearest
// upcoming), one with no date yet, one later, one already done.
const STEPS = [
  step({
    id: 'step-retard',
    name: 'Déposer la déclaration',
    plannedDate: '2026-09-01',
    status: StepStatus.EN_RETARD,
  }),
  step({
    id: 'step-proche',
    name: 'Envoyer les photos',
    plannedDate: '2026-10-20',
    status: StepStatus.A_FAIRE,
  }),
  step({
    id: 'step-sans-date',
    name: 'Demander l’état estimatif',
    plannedDate: null,
    status: StepStatus.A_VENIR,
    anchor: StepAnchor.DATE_ETAT_ESTIMATIF,
  }),
  step({
    id: 'step-plus-tard',
    name: 'Relire le contrat',
    plannedDate: '2027-01-15',
    status: StepStatus.A_VENIR,
  }),
  step({
    id: 'step-fait',
    name: 'Prévenir le voisin',
    plannedDate: '2026-06-20',
    status: StepStatus.FAIT,
    completedAt: '2026-06-20',
  }),
];

function sinistreDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...sinistreFixture({ status: 'DECLARE' }),
    steps: STEPS,
    declarationDeadline: {
      date: '2026-09-15',
      daysLeft: 14,
      source: SOURCE,
    },
    ...overrides,
  };
}

async function openDetail(page: Page, body: unknown) {
  await mockSession(page).install();
  await page.route(`${testApiBaseUrl}/sinistres/${SINISTRE_ID_1}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
  await page.goto(`/sinistres/${SINISTRE_ID_1}`);
}

test('the plan is an ordered list with one item per step, each status named in words', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const timeline = page.getByRole('list', {
    name: fr.sinistres.detail.timelineLabel,
  });
  await expect(timeline.getByRole('listitem')).toHaveCount(STEPS.length);
  await expect(
    timeline.getByRole('listitem').filter({ hasText: 'Envoyer les photos' }),
  ).toContainText(fr.sinistres.detail.stepStatus.A_FAIRE);
  await expect(
    timeline
      .getByRole('listitem')
      .filter({ hasText: 'Déposer la déclaration' }),
  ).toContainText(fr.sinistres.detail.stepStatus.EN_RETARD);
  await expect(
    timeline.getByRole('listitem').filter({ hasText: 'Prévenir le voisin' }),
  ).toContainText(fr.sinistres.detail.stepStatus.FAIT);
});

test('exactly one step carries aria-current, and it is the nearest upcoming one', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const current = page.locator('[aria-current="step"]');
  await expect(current).toHaveCount(1);
  await expect(page.locator('li[aria-current="step"]')).toContainText(
    'Envoyer les photos',
  );
});

test('a step without a planned date is neither overdue nor the next one', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const waiting = page
    .getByRole('listitem')
    .filter({ hasText: 'Demander l’état estimatif' });
  await expect(waiting).not.toHaveAttribute('aria-current', 'step');
  await expect(waiting).not.toContainText(
    fr.sinistres.detail.stepStatus.EN_RETARD,
  );
  await expect(waiting).toContainText(
    fr.sinistres.detail.attentePar.DATE_ETAT_ESTIMATIF,
  );
});

test('an overdue declaration deadline is said in words, with the days past it', async ({
  page,
}) => {
  await openDetail(
    page,
    sinistreDetail({
      declarationDeadline: { date: '2026-09-15', daysLeft: -3 },
    }),
  );

  await expect(
    page.getByText(fr.sinistres.detail.deadline.overdue(3)),
  ).toBeVisible();
  await expect(page.getByText(/Il reste/)).toHaveCount(0);
});

test('the days left before the declaration deadline are shown as a number', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  await expect(
    page.getByText(fr.sinistres.detail.deadline.remaining(14)),
  ).toBeVisible();
});

test('one day left is written in the singular', async ({ page }) => {
  await openDetail(
    page,
    sinistreDetail({
      declarationDeadline: { date: '2026-10-04', daysLeft: 1 },
    }),
  );

  await expect(
    page.getByText(fr.sinistres.detail.deadline.remaining(1), { exact: true }),
  ).toBeVisible();
});

test('each calculated date links to the text it comes from and is called indicative', async ({
  page,
}) => {
  await openDetail(
    page,
    sinistreDetail({
      steps: [
        step({
          id: 'step-declaration',
          name: 'Déclarer le sinistre',
          plannedDate: '2026-09-15',
          status: StepStatus.A_FAIRE,
          source: SOURCE,
        }),
      ],
    }),
  );

  const links = page.getByRole('link', { name: /Voir le texte de référence/ });
  await expect(links).toHaveCount(2);
  await expect(
    page.getByRole('link', {
      name: fr.sinistres.detail.source.lien('Déclarer le sinistre'),
    }),
  ).toHaveAttribute('href', SOURCE.url);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('href', SOURCE.url);
  }
  await expect(
    page.getByText(fr.sinistres.detail.source.indicative),
  ).toHaveCount(2);
});

test('a date whose source was not checked for six months says so in words', async ({
  page,
}) => {
  await openDetail(
    page,
    sinistreDetail({
      declarationDeadline: {
        date: '2026-09-15',
        daysLeft: 14,
        source: { ...SOURCE, possiblyOutdated: true },
      },
    }),
  );

  await expect(
    page.getByText(
      fr.sinistres.detail.source.outdated(REFERENCE_DATA_STALE_AFTER_MONTHS),
    ),
  ).toBeVisible();
});

test('the page is named after the dossier it shows', async ({ page }) => {
  await openDetail(page, sinistreDetail());

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: dossierTitle(sinistreFixture()),
    }),
  ).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the sinistre screen is clean — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openDetail(page, sinistreDetail());
    await expect(
      page.getByRole('list', { name: fr.sinistres.detail.timelineLabel }),
    ).toBeVisible();

    await expectNoAxeViolations(page);
  });
}
