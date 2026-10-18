import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEADLINE_URGENT_THRESHOLD_DAYS,
  REFERENCE_DATA_STALE_AFTER_MONTHS,
  SinistreStatus,
  StepAnchor,
  StepKind,
  StepStatus,
  toIsoDate,
  type IsoDate,
} from '@mon-sinistre/contracts';
import type { StepMark } from '../../src/lib/api/sinistres';
import { dossierTitle } from '../../src/lib/dossier-title';
import {
  dateParts,
  formatDateFr,
  formatDateShortFr,
} from '../../src/i18n/date';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { greenColours } from '../support/contrast';
import { testApiBaseUrl } from '../support/env';
import { mockSession } from '../support/session-mock';
import {
  SINISTRE_ID_1,
  SOURCE,
  sinistreDetailFixture,
  sinistreFixture,
  stepFixture as step,
} from '../support/sinistres';

// Five steps in template order, with the `daysLeft` the API counts as if today
// were 2026-10-13: one overdue, one due this week (the nearest upcoming), one
// with no date yet, one far off, one already done.
const STEPS = [
  step({
    id: 'step-retard',
    name: 'Déposer la déclaration',
    plannedDate: toIsoDate('2026-10-10'),
    status: StepStatus.EN_RETARD,
    daysLeft: -3,
  }),
  step({
    id: 'step-proche',
    name: 'Envoyer les photos',
    plannedDate: toIsoDate('2026-10-20'),
    status: StepStatus.A_FAIRE,
    daysLeft: DEADLINE_URGENT_THRESHOLD_DAYS,
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
    plannedDate: toIsoDate('2026-11-12'),
    status: StepStatus.A_VENIR,
    daysLeft: 30,
  }),
  step({
    id: 'step-fait',
    name: 'Prévenir le voisin',
    plannedDate: toIsoDate('2026-10-10'),
    status: StepStatus.FAIT,
    completedAt: toIsoDate('2026-10-08'),
    daysLeft: -3,
  }),
];

const badgeCopy = fr.deadlineBadge;
const declarationCopy = fr.sinistres.detail.declaration;
const prevueLe = (date: string) =>
  badgeCopy.prevueLe(formatDateShortFr(toIsoDate(date)));

// What the fields of each step above must reach its date line as. The done
// step is not here: it stands in the row of what is behind, by its name alone.
const DATE_LINES: Record<string, string[]> = {
  'step-retard': [badgeCopy.enRetard, prevueLe('2026-10-10')],
  'step-proche': [badgeCopy.derniereSemaine, prevueLe('2026-10-20')],
  'step-sans-date': [fr.sinistres.detail.attentePar.DATE_ETAT_ESTIMATIF],
  'step-plus-tard': [prevueLe('2026-11-12')],
};

function sinistreDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...sinistreDetailFixture({ status: SinistreStatus.DECLARE }),
    steps: STEPS,
    declarationDeadline: {
      date: '2026-10-27',
      daysLeft: 14,
      source: SOURCE,
    },
    ...overrides,
  };
}

const heroBadge = (scope: Page | Locator) =>
  scope.locator('[data-slot="deadline-badge"][data-form="hero"]');
const planList = (page: Page) =>
  page.getByRole('list', { name: fr.sinistres.detail.timelineLabel });

const DECLARATION_STEP = step({
  id: 'step-declaration',
  name: 'Déclarer le sinistre à l’assureur',
  kind: StepKind.DECLARATION,
  plannedDate: toIsoDate('2026-10-27'),
  status: StepStatus.A_FAIRE,
  anchor: StepAnchor.DATE_PUBLICATION_ARRETE,
  daysLeft: 14,
});
const ASSUREUR_STEP = step({
  id: 'step-assureur',
  name: 'L’assureur précise la procédure',
  plannedDate: null,
  status: StepStatus.A_VENIR,
  anchor: StepAnchor.DATE_DECLARATION,
});

// What the API answers once a declaration date is set or cleared: the date
// closes the déclaration step on that day, and the step anchored on it takes
// a date only while the date is there.
function detailDeclaredOn(declarationDate: IsoDate | null) {
  return sinistreDetail({
    declarationDate,
    steps: [
      ...STEPS,
      {
        ...DECLARATION_STEP,
        status: declarationDate ? StepStatus.FAIT : DECLARATION_STEP.status,
        completedAt: declarationDate,
      },
      {
        ...ASSUREUR_STEP,
        plannedDate: declarationDate ? toIsoDate('2026-10-31') : null,
        daysLeft: declarationDate ? 18 : null,
      },
    ],
  });
}

// A PATCH on a step answers from the same state the GET reads, so the refetch
// after a successful mark shows what the API would show.
async function openDetail(
  page: Page,
  body: ReturnType<typeof sinistreDetail>,
  {
    failing = false,
    afterPatch = (declarationDate) => ({
      ...sinistreDetail(),
      declarationDate,
    }),
  }: {
    failing?: boolean;
    afterPatch?: (
      declarationDate: IsoDate | null,
    ) => ReturnType<typeof sinistreDetail>;
  } = {},
) {
  const state = { detail: body };
  await mockSession(page).install();
  await page.route(`${testApiBaseUrl}/sinistres/${SINISTRE_ID_1}`, (route) => {
    const method = route.request().method();
    if (failing && method !== 'GET') {
      return route.fulfill({ status: 500 });
    }
    if (method === 'DELETE') {
      return route.fulfill({ status: 204 });
    }
    if (method === 'PATCH') {
      const { declarationDate } = route.request().postDataJSON() as {
        declarationDate: IsoDate | null;
      };
      state.detail = afterPatch(declarationDate);
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.detail),
    });
  });
  await page.route(/\/etapes\/[^/?]+$/, (route) => {
    if (failing) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Erreur interne' }),
      });
    }
    const stepId = route.request().url().split('/').at(-1) ?? '';
    const { status } = route.request().postDataJSON() as {
      status: StepMark;
    };
    state.detail = {
      ...state.detail,
      steps: state.detail.steps.map((item) =>
        item.id === stepId
          ? { ...item, status: status ?? StepStatus.A_FAIRE }
          : item,
      ),
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.detail.steps.find((s) => s.id === stepId)),
    });
  });
  await page.goto(`/sinistres/${SINISTRE_ID_1}`);
}

test('the plan is an ordered list of what is left to do, each step with its date line', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const timeline = planList(page);
  await expect(timeline.getByRole('listitem')).toHaveCount(
    Object.keys(DATE_LINES).length,
  );
  for (const item of STEPS) {
    const texts = DATE_LINES[item.id];
    const strip = timeline.getByRole('listitem').filter({ hasText: item.name });
    if (!texts) {
      await expect(strip, item.id).toHaveCount(0);
      continue;
    }
    for (const text of texts) {
      await expect(strip, item.id).toContainText(text);
    }
  }
  // The done step is behind the plan, in the row of what is settled.
  await expect(page.locator('[data-slot="plan-fait"]')).toContainText(
    'Prévenir le voisin',
  );
});

test('the lines of text the badges replaced are gone from the page', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());
  await expect(planList(page)).toBeVisible();

  for (const gone of [/Il reste/, /Date limite/, /À faire/]) {
    await expect(page.getByText(gone)).toHaveCount(0);
  }
});

test('exactly one step of the plan carries aria-current, and it is the nearest upcoming one', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  // Within the plan: the chronology of the head marks its own current moment.
  const plan = planList(page);
  await expect(plan.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(plan.locator('li[aria-current="step"]')).toContainText(
    'Envoyer les photos',
  );
});

test('the head stamps the status and holds the only badge of the page', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const entete = page.locator('[data-slot="dossier-entete"]');
  await expect(entete.locator('[data-slot="statut-tampon"]')).toHaveText(
    fr.sinistres.statut[SinistreStatus.DECLARE],
  );
  await expect(heroBadge(entete)).toHaveCount(1);
  // The plan says the state of its steps in the words of their date lines.
  await expect(
    planList(page).locator('[data-slot="deadline-badge"]'),
  ).toHaveCount(0);
});

test('a step without a planned date is neither overdue nor the next one', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const waiting = page
    .getByRole('listitem')
    .filter({ hasText: 'Demander l’état estimatif' });
  await expect(waiting).not.toHaveAttribute('aria-current', 'step');
  await expect(waiting).not.toContainText(badgeCopy.enRetard);
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
      declarationDeadline: {
        date: '2026-10-10',
        daysLeft: -3,
        source: SOURCE,
      },
    }),
  );

  const hero = heroBadge(page);
  await expect(hero).toContainText(badgeCopy.enRetard);
  await expect(hero).toContainText(badgeCopy.compteARebours(-3));
});

test('the days left before the declaration deadline are shown as a number, next to the date', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const hero = heroBadge(page);
  await expect(hero).toContainText(badgeCopy.compteARebours(14));
  await expect(hero).toContainText(dateParts(toIsoDate('2026-10-27')).day);
});

test('on the last day to declare the badge says so', async ({ page }) => {
  await openDetail(
    page,
    sinistreDetail({
      declarationDeadline: {
        date: '2026-10-13',
        daysLeft: 0,
        source: SOURCE,
      },
    }),
  );

  const hero = heroBadge(page);
  await expect(hero).toContainText(badgeCopy.aujourdhui);
  await expect(hero).toContainText(badgeCopy.compteARebours(0));
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
          plannedDate: toIsoDate('2026-09-15'),
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
    await expect(planList(page)).toBeVisible();

    await expectNoAxeViolations(page);
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`a done step fades next to one still to do, with no green on it — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.emulateMedia({ colorScheme });
    await openDetail(
      page,
      sinistreDetail({
        steps: STEPS.filter(({ id }) =>
          ['step-proche', 'step-fait'].includes(id),
        ),
      }),
    );

    // The sheet, not the plan alone: a settled step is read under it, in the
    // row of what is behind.
    const feuille = page.locator('[data-slot="dossier-feuille"]');
    await expect(feuille).toHaveScreenshot(`etapes-${colorScheme}.png`);
    // Done is not a reward: nothing on the settled line lights up in green.
    expect(await greenColours(feuille)).toEqual([]);
  });
}

function timelineItem(page: Page, stepName: string) {
  return page.getByRole('listitem').filter({ hasText: stepName });
}

test('a mark is announced in a live region already on the page, counted by the bookmark, and the other steps stay as they are', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const announcements = page.getByRole('status');
  await expect(announcements).toBeEmpty();
  const bookmark = page.locator('[data-slot="etape-en-cours"]');
  const progression = fr.sinistres.detail.etapeEnCours.progression;
  await expect(bookmark).toContainText(progression(1, STEPS.length));
  const sibling = timelineItem(page, 'Relire le contrat');
  await sibling.evaluate((el) => {
    el.dataset.intact = 'oui';
  });

  await timelineItem(page, 'Envoyer les photos')
    .getByRole('button', { name: fr.sinistres.detail.marquer.fait })
    .click();

  await expect(announcements).toHaveText(
    fr.sinistres.detail.annonce.fait('Envoyer les photos'),
  );
  await expect(page.locator('[data-slot="plan-fait"]')).toContainText(
    'Envoyer les photos',
  );
  // The bookmark follows the answer of the PATCH: one more step behind, and
  // the step in hand is the next one that has a date.
  await expect(bookmark).toContainText(progression(2, STEPS.length));
  await expect(bookmark).toContainText('Relire le contrat');
  // The focus follows the step to the line it moved to, instead of falling
  // back to the top of the page with the strip that held it.
  await expect(timelineItem(page, 'Envoyer les photos')).toBeFocused();
  await expect(sibling).toHaveAttribute('data-intact', 'oui');
});

test('a step can be marked not applicable, and the request says so', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const sent = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' && request.url().endsWith('/step-proche'),
  );
  await timelineItem(page, 'Envoyer les photos')
    .getByRole('button', { name: fr.sinistres.detail.marquer.nonApplicable })
    .click();

  expect((await sent).postDataJSON()).toEqual({
    status: StepStatus.NON_APPLICABLE,
  });
  await expect(page.getByRole('status')).toHaveText(
    fr.sinistres.detail.annonce.nonApplicable('Envoyer les photos'),
  );
});

test('un-marking a done step sends null, and the step falls back to its computed status', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const sent = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' && request.url().endsWith('/step-fait'),
  );
  await timelineItem(page, 'Prévenir le voisin')
    .getByRole('button', { name: fr.sinistres.detail.marquer.annuler })
    .click();

  expect((await sent).postDataJSON()).toEqual({ status: null });
  await expect(page.getByRole('status')).toHaveText(
    fr.sinistres.detail.annonce.annule('Prévenir le voisin'),
  );
  await expect(timelineItem(page, 'Prévenir le voisin')).toContainText(
    badgeCopy.enRetard,
  );
});

test('a mark that fails leaves the step as it was and says so in French', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail(), { failing: true });

  const step = timelineItem(page, 'Envoyer les photos');
  await step
    .getByRole('button', { name: fr.sinistres.detail.marquer.fait })
    .click();

  await expect(page.getByRole('status')).toHaveText(
    fr.sinistres.detail.marquageEchec,
  );
  await expect(step).toContainText(badgeCopy.derniereSemaine);
});

test('a declaration date closes its step and counts the steps anchored on it, and clearing it takes both back', async ({
  page,
}) => {
  await openDetail(page, detailDeclaredOn(null), {
    afterPatch: detailDeclaredOn,
  });

  const declarationStep = timelineItem(page, DECLARATION_STEP.name);
  const assureurStep = timelineItem(page, ASSUREUR_STEP.name);
  const faits = page.locator('[data-slot="plan-fait"]');
  await expect(assureurStep).toContainText(
    fr.sinistres.detail.attentePar.DATE_DECLARATION,
  );

  const sent = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' && request.url().endsWith(SINISTRE_ID_1),
  );
  await declarationStep.getByLabel(declarationCopy.label).fill('2026-09-01');
  await declarationStep
    .getByRole('button', { name: declarationCopy.enregistrer })
    .click();

  expect((await sent).postDataJSON()).toEqual({
    declarationDate: '2026-09-01',
  });
  await expect(page.getByRole('status')).toHaveText(
    declarationCopy.enregistree,
  );
  await expect(assureurStep).toContainText(prevueLe('2026-10-31'));
  // The date recorded, the step is behind: its line says the day instead of
  // asking for it, keeps the way back, and the keyboard follows the step
  // rather than falling to <body> — as after a mark.
  await expect(faits).toContainText(DECLARATION_STEP.name);
  await expect(declarationStep).toContainText(
    badgeCopy.fait(formatDateFr(toIsoDate('2026-09-01'))),
  );
  await expect(declarationStep.getByLabel(declarationCopy.label)).toHaveCount(
    0,
  );
  await expect(declarationStep).toBeFocused();
  await expect(
    declarationStep.getByRole('button', {
      name: fr.sinistres.detail.marquer.annuler,
    }),
  ).toHaveCount(0);

  await declarationStep
    .getByRole('button', { name: declarationCopy.effacer })
    .click();

  await expect(page.getByRole('status')).toHaveText(declarationCopy.effacee);
  await expect(assureurStep).toContainText(
    fr.sinistres.detail.attentePar.DATE_DECLARATION,
  );
  await expect(assureurStep).not.toContainText(prevueLe('2026-10-31'));
  await expect(faits).not.toContainText(DECLARATION_STEP.name);
  await expect(declarationStep.getByLabel(declarationCopy.label)).toHaveValue(
    '',
  );
  await expect(declarationStep).toBeFocused();
});

test('a clear that fails is announced, and the recorded date is not blamed for it', async ({
  page,
}) => {
  const declared = toIsoDate('2026-09-01');
  await openDetail(page, detailDeclaredOn(declared), { failing: true });

  const declarationStep = timelineItem(page, DECLARATION_STEP.name);
  await declarationStep
    .getByRole('button', { name: declarationCopy.effacer })
    .click();

  await expect(page.getByRole('status')).toHaveText(
    declarationCopy.effacementEchec,
  );
  await expect(declarationStep).toContainText(
    badgeCopy.fait(formatDateFr(declared)),
  );
  await expect(page.getByText(declarationCopy.echec)).toHaveCount(0);
});

test('the strip follows a date recorded elsewhere once the dossier is refetched', async ({
  page,
}) => {
  await openDetail(page, detailDeclaredOn(null));
  const declarationStep = timelineItem(page, DECLARATION_STEP.name);
  await declarationStep.getByLabel(declarationCopy.label).fill('2026-09-01');

  // Another device set the date meanwhile; the next refetch brings it here.
  const elsewhere = toIsoDate('2026-09-15');
  await page.route(`${testApiBaseUrl}/sinistres/${SINISTRE_ID_1}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detailDeclaredOn(elsewhere)),
    }),
  );
  await timelineItem(page, 'Envoyer les photos')
    .getByRole('button', { name: fr.sinistres.detail.marquer.fait })
    .click();

  await expect(declarationStep).toContainText(
    badgeCopy.fait(formatDateFr(elsewhere)),
  );
  await expect(declarationStep.getByLabel(declarationCopy.label)).toHaveCount(
    0,
  );
});

test('deleting the dossier asks first, and cancelling gives focus back to the delete button', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());

  const deleteButton = page.getByRole('button', {
    name: fr.sinistres.detail.suppression.ouvrir,
  });
  await deleteButton.click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(fr.sinistres.detail.suppression.titre);
  await dialog
    .getByRole('button', { name: fr.sinistres.detail.suppression.annuler })
    .click();

  await expect(dialog).toBeHidden();
  await expect(deleteButton).toBeFocused();
});

test('Escape closes the deletion dialog without deleting anything', async ({
  page,
}) => {
  let deleteSent = false;
  await openDetail(page, sinistreDetail());
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deleteSent = true;
  });

  const deleteButton = page.getByRole('button', {
    name: fr.sinistres.detail.suppression.ouvrir,
  });
  await deleteButton.click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(deleteButton).toBeFocused();
  expect(deleteSent).toBe(false);
});

test('confirming the deletion sends DELETE and returns to the list', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail());
  await page.route(`${testApiBaseUrl}/sinistres`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    }),
  );

  const sent = page.waitForRequest(
    (request) =>
      request.method() === 'DELETE' && request.url().endsWith(SINISTRE_ID_1),
  );
  await page
    .getByRole('button', { name: fr.sinistres.detail.suppression.ouvrir })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: fr.sinistres.detail.suppression.confirmer })
    .click();

  await sent;
  await expect(page).toHaveURL(/\/sinistres$/);
});

test('a deletion that fails says so in a live region that was in the dialog all along', async ({
  page,
}) => {
  await openDetail(page, sinistreDetail(), { failing: true });
  await page
    .getByRole('button', { name: fr.sinistres.detail.suppression.ouvrir })
    .click();

  const dialog = page.getByRole('alertdialog');
  const alert = dialog.getByRole('alert');
  await expect(alert).toBeAttached();
  await expect(alert).toBeEmpty();

  await dialog
    .getByRole('button', { name: fr.sinistres.detail.suppression.confirmer })
    .click();

  await expect(alert).toHaveText(fr.sinistres.detail.suppression.echec);
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/sinistres/${SINISTRE_ID_1}$`));
});

test('axe: the deletion dialog is clean in the light theme', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openDetail(page, sinistreDetail());
  await page
    .getByRole('button', { name: fr.sinistres.detail.suppression.ouvrir })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();

  await expectNoAxeViolations(page);
});
