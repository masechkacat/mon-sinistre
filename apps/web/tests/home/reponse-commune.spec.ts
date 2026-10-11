import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ArreteEntryOutcome,
  RisqueCatnat,
  toIsoDate,
} from '@mon-sinistre/contracts';
import { formatDateFr } from '../../src/i18n/date';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from '../support/a11y';
import { NIMES } from '../support/communes';
import { deferred } from '../support/deferred';
import {
  ARRETE,
  DEADLINE,
  communeArreteFixture,
  mockCommuneArretes,
  reponseCommunePath,
} from '../support/dossier';

const copy = fr.reponseCommune;
const ouvrir = { name: new RegExp(copy.ouvrir) };
/** The cards of the answer, apart from the lists of the page around them. */
const cartes = (page: Page) => page.getByTestId(/^arrete-/);
/** The announcement of the answer, apart from the subscription line's own
 * live region under it. */
const annonce = (page: Page) =>
  page.getByTestId('reponse-arretes').getByRole('status');
const risqueLabel = (risque: RisqueCatnat) =>
  fr.sinistres.risque.options[risque].label;

/** The address of a dossier button, read the way the browser would read it. */
async function hrefParams(link: Locator) {
  const href = (await link.getAttribute('href')) ?? '';
  return new URL(href, 'https://mon-sinistre.test').searchParams;
}

test('a commune with no recent arrêté is told so, and the dossier stays on offer', async ({
  page,
}) => {
  await mockCommuneArretes(page, []);
  await page.goto(reponseCommunePath());

  await expect(annonce(page)).toHaveText(copy.aucun(NIMES.name));
  await expect(page.getByRole('link', { name: copy.preparer })).toHaveAttribute(
    'href',
    `/dossier?commune=${NIMES.codeInsee}`,
  );
  await expect(page.getByRole('link', ouvrir)).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('a recognised arrêté is shown with its deadline and opens its own dossier', async ({
  page,
}) => {
  const arrete = communeArreteFixture();
  await mockCommuneArretes(page, [arrete]);
  await page.goto(reponseCommunePath());

  const carte = cartes(page);
  await expect(carte).toHaveCount(1);
  // The wording of the JO stays reachable beside the category it classifies to.
  await expect(
    page.getByRole('heading', { name: risqueLabel(RisqueCatnat.INONDATION) }),
  ).toHaveAttribute('title', arrete.risqueLabel);
  await expect(carte).toContainText(
    copy.periode(
      formatDateFr(ARRETE.eventStart),
      formatDateFr(ARRETE.eventEnd),
    ),
  );
  await expect(carte).toContainText(
    fr.dossier.publieLe(formatDateFr(ARRETE.publishedAt)),
  );
  await expect(
    carte.getByRole('link', { name: fr.dossier.legifranceLink }),
  ).toHaveAttribute('href', ARRETE.legifranceUrl);
  await expect(page.locator('[data-slot="deadline-badge"]')).toContainText(
    fr.deadlineBadge.compteARebours(DEADLINE.daysLeft),
  );

  const params = await hrefParams(page.getByRole('link', ouvrir));
  expect(params.get('commune')).toBe(NIMES.codeInsee);
  expect(params.get('risque')).toBe(RisqueCatnat.INONDATION);
  expect(params.get('date')).toBe(ARRETE.eventStart);
  await expectNoAxeViolations(page);
});

test('two arrêtés get a dossier button each, in the order of the answer', async ({
  page,
}) => {
  const secheresse = communeArreteFixture({
    arreteEntryId: 'entry-secheresse',
    risqueLabel: 'Sécheresse',
    risques: [RisqueCatnat.SECHERESSE],
    eventStart: toIsoDate('2026-07-01'),
    eventEnd: toIsoDate('2026-09-30'),
  });
  await mockCommuneArretes(page, [secheresse, communeArreteFixture()]);
  await page.goto(reponseCommunePath());

  const boutons = page.getByRole('link', ouvrir);
  await expect(boutons).toHaveCount(2);
  expect((await hrefParams(boutons.first())).get('risque')).toBe(
    RisqueCatnat.SECHERESSE,
  );
  expect((await hrefParams(boutons.last())).get('risque')).toBe(
    RisqueCatnat.INONDATION,
  );
});

test('a refusal is named in words and carries no deadline', async ({
  page,
}) => {
  await mockCommuneArretes(page, [
    communeArreteFixture({
      outcome: ArreteEntryOutcome.REFUSE,
      declarationDeadline: null,
    }),
  ]);
  await page.goto(reponseCommunePath());

  await expect(cartes(page)).toContainText(copy.refus);
  await expect(page.locator('[data-slot="deadline-badge"]')).toHaveCount(0);
  // The dossier is still on offer: the plan of the first days does not depend
  // on the recognition (docs/prd/dossier-preliminaire.md).
  await expect(page.getByRole('link', ouvrir)).toHaveCount(1);
  await expectNoAxeViolations(page);
});

test('an expired deadline is named in words, without counting the days past it', async ({
  page,
}) => {
  await mockCommuneArretes(page, [
    communeArreteFixture({
      declarationDeadline: { ...DEADLINE, daysLeft: -3 },
    }),
  ]);
  await page.goto(reponseCommunePath());

  const carte = cartes(page);
  await expect(carte).toContainText(fr.dossier.delaiExpire);
  await expect(page.locator('[data-slot="deadline-badge"]')).toHaveCount(0);
  await expect(carte).not.toContainText(fr.deadlineBadge.compteARebours(-3));
  await expect(carte).not.toContainText('-3');
});

test('an arrêté naming several risks asks the dossier page which one', async ({
  page,
}) => {
  await mockCommuneArretes(page, [
    communeArreteFixture({
      risqueLabel: 'Inondations, coulées de boue et mouvements de terrain',
      risques: [RisqueCatnat.INONDATION, RisqueCatnat.MOUVEMENT_TERRAIN],
    }),
  ]);
  await page.goto(reponseCommunePath());

  const params = await hrefParams(page.getByRole('link', ouvrir));
  expect(params.get('risques')).toBe(
    `${RisqueCatnat.INONDATION},${RisqueCatnat.MOUVEMENT_TERRAIN}`,
  );
  expect(params.get('risque')).toBeNull();
  expect(params.get('date')).toBe(ARRETE.eventStart);
});

test('the number of arrêtés is announced in a region mounted before the answer', async ({
  page,
}) => {
  const held = deferred();
  await mockCommuneArretes(
    page,
    [communeArreteFixture(), communeArreteFixture({ arreteEntryId: 'autre' })],
    held,
  );
  await page.goto(reponseCommunePath());

  await expect(annonce(page)).toHaveText(copy.chargement);
  held.release();
  await expect(annonce(page)).toHaveText(copy.trouves(2, NIMES.name));
});
