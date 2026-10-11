import { expect, test, type Page } from '@playwright/test';
import {
  ArreteEntryOutcome,
  RisqueCatnat,
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
import { dossierPath } from '../../src/lib/dossier-params';
import { loginPathWithNext } from '../../src/lib/api/session';
import { dossierTitle } from '../../src/lib/dossier-title';
import { RISQUES } from '../../src/lib/risques';
import { expectNoAxeViolations } from '../support/a11y';
import { NIMES, mockCommuneSearch, selectNimes } from '../support/communes';
import {
  APERCU_PARAMS,
  APERCU_STEPS,
  ARRETE,
  AUTRE_DATE_EVENEMENT,
  DEADLINE,
  DOSSIER_FORM_PATH,
  DOSSIER_PATH,
  apercuFixture,
  mockApercu,
} from '../support/dossier';
import { testApiBaseUrl } from '../support/env';
import { expectErrorTiedTo } from '../support/form';
import { mockNoSession, mockSession } from '../support/session-mock';
import {
  SINISTRE_ID_1,
  SINISTRE_ID_2,
  SOURCE,
  conflictReply,
  createdReply,
  mockCreateSinistre,
} from '../support/sinistres';

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
  // A refused arrêté covers nothing to refine the date in.
  await expect(dateField(page)).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(1);
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
  await expect(planItem(page, APERCU_STEPS.declaration)).not.toContainText(
    badgeCopy.compteARebours(DEADLINE_EXPIRE.daysLeft),
  );
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

test('with no session, saving the dossier carries its three parameters to the registration page', async ({
  page,
}) => {
  await mockNoSession(page);
  await openDossier(page, apercuFixture());

  await page.getByRole('button', { name: fr.dossier.enregistrer }).click();

  await expect(page).toHaveURL(dossierPath('/inscription', APERCU_PARAMS));
});

test('a refresh that gets no answer reports a failure rather than asking to register', async ({
  page,
}) => {
  // The cookie may well be valid: only the API's own 401 says it is not.
  await page.route(`${testApiBaseUrl}/auth/refresh`, (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await openDossier(page, apercuFixture());

  await page.getByRole('button', { name: fr.dossier.enregistrer }).click();

  await expect(page.getByTestId('request-error')).toBeVisible();
  await expect(page).toHaveURL(DOSSIER_PATH);
});

test('with a session, the same button saves the dossier and opens it as a sinistre', async ({
  page,
}) => {
  await mockSession(page).install();
  const sent = await mockCreateSinistre(page, [
    createdReply(SINISTRE_ID_1, 201),
  ]);
  await openDossier(page, apercuFixture());

  await page.getByRole('button', { name: fr.dossier.enregistrer }).click();

  await expect(page).toHaveURL(`/sinistres/${SINISTRE_ID_1}`);
  expect(sent).toEqual([
    {
      codeInsee: APERCU_PARAMS.commune,
      risque: APERCU_PARAMS.risque,
      eventDate: APERCU_PARAMS.date,
    },
  ]);
});

test('a dossier already open for the commune is asked about instead of being doubled', async ({
  page,
}) => {
  await mockSession(page).install();
  await mockCreateSinistre(page, [
    conflictReply(SINISTRE_ID_2, AUTRE_DATE_EVENEMENT),
  ]);
  await openDossier(page, apercuFixture());

  await page.getByRole('button', { name: fr.dossier.enregistrer }).click();

  await expect(
    page.getByRole('link', { name: fr.sinistres.doublon.ouvrir }),
  ).toHaveAttribute('href', `/sinistres/${SINISTRE_ID_2}`);
  await expect(
    page.getByRole('list', { name: copy.timelineLabel }),
  ).toHaveCount(0);
});

test('“revenir et corriger” gives the aperçu back with its save button focused', async ({
  page,
}) => {
  await mockSession(page).install();
  await mockCreateSinistre(page, [
    conflictReply(SINISTRE_ID_2, AUTRE_DATE_EVENEMENT),
  ]);
  await openDossier(page, apercuFixture());

  await page.getByRole('button', { name: fr.dossier.enregistrer }).click();
  await page
    .getByRole('button', { name: fr.sinistres.doublon.corriger })
    .click();

  await expect(
    page.getByRole('button', { name: fr.dossier.enregistrer }),
  ).toBeFocused();
  await expect(page.getByTestId('dossier-existant')).toHaveCount(0);
});

test('a session lost on saving sends to the login on the way back to this dossier', async ({
  page,
}) => {
  await mockSession(page).install();
  await page.route(`${testApiBaseUrl}/sinistres`, (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await openDossier(page, apercuFixture());

  await page.getByRole('button', { name: fr.dossier.enregistrer }).click();

  await expect(page).toHaveURL(loginPathWithNext(DOSSIER_PATH));
});

test('a save that failed stops being reported once the date is refined', async ({
  page,
}) => {
  await mockSession(page).install();
  await mockCreateSinistre(page, [
    { status: 500, contentType: 'application/json', body: '{}' },
  ]);
  await openDossier(page, apercuPublie());

  await page.getByRole('button', { name: fr.dossier.enregistrer }).click();
  await expect(page.getByTestId('request-error')).toBeVisible();

  await dateField(page).fill(ARRETE.eventEnd);
  await page
    .getByRole('button', { name: fr.dossier.formulaire.preciser.submit })
    .click();

  await expect(page).toHaveURL(
    dossierPath('/dossier', { ...APERCU_PARAMS, date: ARRETE.eventEnd }),
  );
  await expect(page.getByTestId('request-error')).toHaveCount(0);
});

const communeField = (page: Page) =>
  page.getByLabel(fr.sinistres.nouveau.communeLabel);
const dateField = (page: Page) =>
  page.getByLabel(fr.sinistres.nouveau.eventDateLabel);
const formSubmit = (page: Page) =>
  page.getByRole('button', { name: fr.dossier.formulaire.submit });

test('an empty address asks for the three parameters and sends no request', async ({
  page,
}) => {
  let apercuCalled = false;
  await page.route(`${testApiBaseUrl}/dossier/apercu**`, (route) => {
    apercuCalled = true;
    return route.fulfill({ status: 200, body: '{}' });
  });
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);

  await page.goto(DOSSIER_FORM_PATH);

  await expect(
    page.getByRole('heading', { level: 1, name: fr.dossier.formulaire.titre }),
  ).toBeVisible();
  await expect(communeField(page)).toBeVisible();
  await expect(page.getByRole('radiogroup')).toBeVisible();
  await expect(dateField(page)).toBeVisible();
  // Nothing to preview: with no parameter the request would be the API's own
  // 400, and the page already knows what it has to ask for.
  expect(apercuCalled).toBe(false);
});

test('the commune alone leaves the risk and the date to ask, and the answer lands in the address', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await mockApercu(page, apercuFixture());

  await page.goto(`/dossier?commune=${NIMES.codeInsee}`);

  await expect(communeField(page)).toHaveCount(0);
  await page
    .getByRole('radio', { name: fr.sinistres.risque.options.INONDATION.label })
    .click();
  await dateField(page).fill(APERCU_PARAMS.date);
  await formSubmit(page).click();

  await expect(page).toHaveURL(DOSSIER_PATH);
  await expect(
    page.getByRole('list', { name: copy.timelineLabel }),
  ).toBeVisible();
});

test('an empty form reports what is missing, field by field, and stays on the address', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);

  await page.goto(DOSSIER_FORM_PATH);
  await formSubmit(page).click();

  await expectErrorTiedTo(
    communeField(page),
    page.getByText(fr.sinistres.nouveau.communeRequiredError),
  );
  await expectErrorTiedTo(
    page.getByRole('radiogroup'),
    page.getByText(fr.sinistres.risque.requiredError),
  );
  await expectErrorTiedTo(
    dateField(page),
    page.getByText(fr.sinistres.nouveau.eventDateRequiredError),
  );
  await expect(page).toHaveURL(DOSSIER_FORM_PATH);
});

test('an arrêté naming several risks limits the choice to those it names', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await mockApercu(page, apercuFixture());

  await page.goto(
    `/dossier?commune=${NIMES.codeInsee}&risques=INONDATION,MOUVEMENT_TERRAIN&date=${APERCU_PARAMS.date}`,
  );

  await expect(page.getByRole('radio')).toHaveCount(2);
  for (const risque of [
    RisqueCatnat.INONDATION,
    RisqueCatnat.MOUVEMENT_TERRAIN,
  ]) {
    await expect(
      page.getByRole('radio', {
        name: fr.sinistres.risque.options[risque].label,
      }),
    ).toBeVisible();
  }
  // Only the date is already answered, so the radio is the whole form here.
  await expect(dateField(page)).toHaveCount(0);

  await page
    .getByRole('radio', { name: fr.sinistres.risque.options.INONDATION.label })
    .click();
  await formSubmit(page).click();

  // The hint from the commune answer has done its job and leaves the address.
  await expect(page).toHaveURL(DOSSIER_PATH);
});

test('with no hint in the address every category stays open', async ({
  page,
}) => {
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);

  await page.goto(DOSSIER_FORM_PATH);

  await expect(page.getByRole('radio')).toHaveCount(RISQUES.length);
});

test('with an arrêté the date is refined inside its period, and nowhere outside it', async ({
  page,
}) => {
  await openDossier(page, apercuPublie());

  const date = dateField(page);
  await expect(date).toHaveValue(APERCU_PARAMS.date);
  await expect(date).toHaveAttribute('min', ARRETE.eventStart);
  await expect(date).toHaveAttribute('max', ARRETE.eventEnd);
  const preciser = page.getByRole('button', {
    name: fr.dossier.formulaire.preciser.submit,
  });

  await date.fill('2026-09-30');
  await preciser.click();

  await expectErrorTiedTo(
    date,
    page.getByText(
      fr.sinistres.nouveau.eventDatePeriodeError(
        formatDateFr(ARRETE.eventStart),
        formatDateFr(ARRETE.eventEnd),
      ),
    ),
  );
  await expect(page).toHaveURL(DOSSIER_PATH);

  await date.fill(ARRETE.eventEnd);
  await preciser.click();

  await expect(page).toHaveURL(
    dossierPath('/dossier', { ...APERCU_PARAMS, date: ARRETE.eventEnd }),
  );
  await expect(preciser).toBeFocused();
});

test('refining the date to the one already shown says so instead of doing nothing', async ({
  page,
}) => {
  await openDossier(page, apercuPublie());

  await page
    .getByRole('button', { name: fr.dossier.formulaire.preciser.submit })
    .click();

  await expect(
    page.getByText(fr.dossier.formulaire.inchange.preciser),
  ).toBeVisible();
  await expect(page).toHaveURL(DOSSIER_PATH);
});

/** Counts the aperçu requests, each answered with the API's 400. */
async function refuseApercu(page: Page) {
  const calls = { count: 0 };
  await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);
  await page.route(`${testApiBaseUrl}/dossier/apercu**`, (route) => {
    calls.count += 1;
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 400,
        message: ['La date de l’événement ne peut pas être dans le futur.'],
        error: 'Bad Request',
      }),
    });
  });
  await page.goto(DOSSIER_PATH);
  await expect(
    page.getByText(fr.dossier.formulaire.parametresRefuses),
  ).toBeVisible();
  return calls;
}

test('parameters the API refuses come back as the form, with an explanation instead of a server error', async ({
  page,
}) => {
  const calls = await refuseApercu(page);

  // A 400 answers the same way twice: it is not retried.
  expect(calls.count).toBe(1);
  await expect(page.getByTestId('request-error')).toHaveCount(0);
  // The refusal does not say which of the three it could not use, so all
  // three are asked again — the risk and the date keeping what the address
  // said, the commune asked anew since only its code travelled.
  await expect(communeField(page)).toBeVisible();
  await expect(
    page.getByRole('radio', {
      name: fr.sinistres.risque.options.INONDATION.label,
    }),
  ).toBeChecked();
  await expect(dateField(page)).toHaveValue(APERCU_PARAMS.date);
});

test('the refused parameters sent again are named unchanged, not sent to the API', async ({
  page,
}) => {
  const calls = await refuseApercu(page);

  await selectNimes(page, fr.sinistres.nouveau.communeLabel);
  await formSubmit(page).click();

  await expect(
    page.getByText(fr.dossier.formulaire.inchange.refuse),
  ).toBeVisible();
  expect(calls.count).toBe(1);
});

test('the address alone opens the dossier in a browser that has never seen it', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const apercu = apercuPublie();
  await openDossier(page, apercu);

  await expect(
    page.getByRole('heading', { level: 1, name: dossierTitle(apercu) }),
  ).toBeVisible();
  await expect(heroBadge(page)).toContainText(
    badgeCopy.compteARebours(DEADLINE.daysLeft),
  );
  await context.close();
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

  // The form state stays out of the shared page registry: every tab stop
  // inside Chrome's segmented date input keeps `document.activeElement` on
  // the input itself, which the registry's keyboard pass reads as a stop
  // without visible focus. Hence axe here, on the state it cannot host.
  test(`axe: the dossier form is clean at 360 px — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.emulateMedia({ colorScheme });
    await page.route(`${testApiBaseUrl}/communes**`, mockCommuneSearch);

    await page.goto(DOSSIER_FORM_PATH);
    await expect(dateField(page)).toBeVisible();

    await expectNoAxeViolations(page);
  });
}
