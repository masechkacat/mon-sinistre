import { expect, test, type Page } from '@playwright/test';
import {
  ArreteEntryOutcome,
  SinistreStatus,
  StepKind,
  StepStatus,
  toIsoDate,
  type DeclarationDeadline,
  type DossierApercu,
  type StepView,
} from '@mon-sinistre/contracts';
import { formatDateFr, formatDateShortFr } from '../../src/i18n/date';
import { fr } from '../../src/i18n/fr';
import { dossierSearch } from '../../src/lib/dossier-params';
import { dossierTitle } from '../../src/lib/dossier-title';
import { expectNoAxeViolations } from '../support/a11y';
import {
  APERCU_PARAMS,
  APERCU_STEPS,
  ARRETE,
  DEADLINE,
  DOSSIER_PATH,
  apercuFixture,
  mockApercu,
} from '../support/dossier';
import { SOURCE } from '../support/sinistres';

const copy = fr.sinistres.detail;
const badgeCopy = fr.deadlineBadge;

// The déclaration step takes its date from the arrêté: with a publication, the
// 30-day deadline is its planned date.
function declarationStep(deadline: DeclarationDeadline): StepView {
  return {
    ...APERCU_STEPS.declaration,
    plannedDate: deadline.date,
    status: deadline.daysLeft < 0 ? StepStatus.EN_RETARD : StepStatus.A_FAIRE,
    daysLeft: deadline.daysLeft,
    source: SOURCE,
  };
}

function apercuPublie(deadline = DEADLINE): DossierApercu {
  return apercuFixture({
    status: SinistreStatus.ARRETE_PUBLIE,
    arrete: ARRETE,
    declarationDeadline: deadline,
    steps: [
      APERCU_STEPS.photos,
      APERCU_STEPS.prevenir,
      declarationStep(deadline),
    ],
  });
}

const APERCU_REFUSE = apercuFixture({
  status: SinistreStatus.ARRETE_REFUSE,
  arrete: { ...ARRETE, outcome: ArreteEntryOutcome.REFUSE },
});

const DEADLINE_EXPIRE: DeclarationDeadline = {
  date: toIsoDate('2026-10-05'),
  daysLeft: -5,
  source: SOURCE,
};

const heroBadge = (page: Page) =>
  page.locator('[data-slot="deadline-badge"][data-form="hero"]');
// By role, not by text: the source link under the block repeats the heading.
const deadlineHeading = (page: Page) =>
  page.getByRole('heading', { name: copy.deadline.heading });
const legifranceLink = (page: Page) =>
  page.getByRole('link', { name: fr.dossier.legifranceLink });
const planItem = (page: Page, step: StepView) =>
  page.getByRole('listitem').filter({ hasText: step.name });

async function openDossier(page: Page, apercu: DossierApercu) {
  await mockApercu(page, apercu);
  await page.goto(DOSSIER_PATH);
  await expect(
    page.getByRole('list', { name: copy.timelineLabel }),
  ).toBeVisible();
}

test('arrêté attendu: the step anchored on the publication waits without a date, and no deadline is shown', async ({
  page,
}) => {
  const apercu = apercuFixture();
  await openDossier(page, apercu);

  await expect(
    page.getByRole('heading', { level: 1, name: dossierTitle(apercu) }),
  ).toBeVisible();
  await expect(
    page.getByText(fr.sinistres.statut[SinistreStatus.AVANT_ARRETE]),
  ).toBeVisible();
  await expect(
    page.getByText(
      fr.sinistres.liste.eventDate(formatDateFr(apercu.eventDate)),
    ),
  ).toBeVisible();

  const declaration = planItem(page, APERCU_STEPS.declaration);
  await expect(declaration).toContainText(badgeCopy.dateAVenir);
  await expect(declaration).toContainText(
    copy.attentePar.DATE_PUBLICATION_ARRETE,
  );
  await expect(heroBadge(page)).toHaveCount(0);
  await expect(legifranceLink(page)).toHaveCount(0);
});

test('arrêté publié: the publication date, its Légifrance link and the deadline with the days left', async ({
  page,
}) => {
  await openDossier(page, apercuPublie());

  await expect(
    page.getByText(fr.sinistres.statut[SinistreStatus.ARRETE_PUBLIE]),
  ).toBeVisible();
  await expect(
    page.getByText(fr.dossier.publieLe(formatDateFr(ARRETE.publishedAt))),
  ).toBeVisible();
  await expect(legifranceLink(page)).toHaveAttribute(
    'href',
    ARRETE.legifranceUrl,
  );

  await expect(deadlineHeading(page)).toBeVisible();
  await expect(heroBadge(page)).toContainText(
    badgeCopy.compteARebours(DEADLINE.daysLeft),
  );
  await expect(planItem(page, APERCU_STEPS.declaration)).toContainText(
    badgeCopy.prevueLe(formatDateShortFr(DEADLINE.date)),
  );
});

test('arrêté refusé: the refusal is named in words, with a link to the arrêté and no deadline', async ({
  page,
}) => {
  await openDossier(page, APERCU_REFUSE);

  await expect(
    page.getByText(fr.sinistres.statut[SinistreStatus.ARRETE_REFUSE]),
  ).toBeVisible();
  await expect(legifranceLink(page)).toHaveAttribute(
    'href',
    ARRETE.legifranceUrl,
  );
  await expect(heroBadge(page)).toHaveCount(0);
  await expect(deadlineHeading(page)).toHaveCount(0);
});

test('an expired deadline is named expired in words, with no count of the days past it', async ({
  page,
}) => {
  await openDossier(page, apercuPublie(DEADLINE_EXPIRE));

  await expect(deadlineHeading(page)).toBeVisible();
  await expect(page.locator('[data-slot="delai-expire"]')).toHaveText(
    fr.dossier.delaiExpire,
  );
  expect(fr.dossier.delaiExpire).not.toMatch(/\d/);
  await expect(heroBadge(page)).toHaveCount(0);
});

test('the containers are shown empty, and the page carries one single action', async ({
  page,
}) => {
  await openDossier(page, apercuFixture());

  await expect(
    planItem(page, APERCU_STEPS.photos).locator('[data-slot="plan-conteneur"]'),
  ).toHaveText(fr.dossier.conteneur[StepKind.PHOTOS]);
  await expect(
    planItem(page, APERCU_STEPS.declaration).locator(
      '[data-slot="plan-conteneur"]',
    ),
  ).toHaveText(fr.dossier.conteneur[StepKind.DECLARATION]);

  await expect(page.getByRole('button')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: fr.dossier.enregistrer }),
  ).toBeVisible();
});

test('saving the dossier carries its three parameters to the registration page', async ({
  page,
}) => {
  await openDossier(page, apercuFixture());

  await page.getByRole('button', { name: fr.dossier.enregistrer }).click();

  await expect(page).toHaveURL(`/inscription${dossierSearch(APERCU_PARAMS)}`);
});

test('a failed request says so in French instead of showing an empty plan', async ({
  page,
}) => {
  await page.route(/\/dossier\/apercu/, (route) =>
    route.fulfill({ status: 500 }),
  );
  await page.goto(DOSSIER_PATH);

  await expect(page.getByTestId('request-error')).toBeVisible();
  await expect(
    page.getByRole('list', { name: copy.timelineLabel }),
  ).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe: the dossier page is clean at 360 px — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.emulateMedia({ colorScheme });
    await openDossier(page, apercuPublie());

    await expectNoAxeViolations(page);
  });
}
