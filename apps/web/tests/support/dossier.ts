import type { Route } from 'next';
import type { Page } from '@playwright/test';
import {
  ArreteEntryOutcome,
  RisqueCatnat,
  SinistreStatus,
  StepAnchor,
  StepKind,
  StepStatus,
  toIsoDate,
  type ArreteCoverage,
  type DeclarationDeadline,
  type DossierApercu,
} from '@mon-sinistre/contracts';
import { dossierSearch } from '../../src/lib/dossier-params';
import { NIMES } from './communes';
import { testApiBaseUrl } from './env';
import { SOURCE, stepViewFixture } from './sinistres';

/** The three parameters of the dossier under test: the address is the dossier. */
export const APERCU_PARAMS = {
  commune: NIMES.codeInsee,
  risque: RisqueCatnat.INONDATION,
  date: toIsoDate('2026-09-13'),
};

export const DOSSIER_PATH = `/dossier${dossierSearch(APERCU_PARAMS)}` as Route;

/** The same page with an empty address: it asks for the three parameters. */
export const DOSSIER_FORM_PATH = '/dossier' satisfies Route;

/** An arrêté whose event period covers the date of APERCU_PARAMS. */
export const ARRETE: ArreteCoverage = {
  publishedAt: toIsoDate('2026-09-20'),
  legifranceUrl: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000050100001',
  outcome: ArreteEntryOutcome.RECONNU,
  eventStart: toIsoDate('2026-09-10'),
  eventEnd: toIsoDate('2026-09-15'),
};

/** The déclaration deadline the arrêté above opens, still running. */
export const DEADLINE: DeclarationDeadline = {
  date: toIsoDate('2026-10-20'),
  daysLeft: 9,
  source: SOURCE,
};

/**
 * Three steps of the CATNAT plan: a container with a date of its own, a plain
 * action with its source, and the déclaration — anchored on the publication,
 * so dateless until an arrêté is out.
 */
export const APERCU_STEPS = {
  photos: stepViewFixture({
    name: 'Photographier et filmer les dégâts',
    kind: StepKind.PHOTOS,
    plannedDate: toIsoDate('2026-09-14'),
    status: StepStatus.A_FAIRE,
    anchor: StepAnchor.DATE_SINISTRE,
    daysLeft: 1,
    order: 1,
  }),
  prevenir: stepViewFixture({
    name: 'Prévenir votre assureur',
    plannedDate: toIsoDate('2026-09-18'),
    status: StepStatus.A_FAIRE,
    anchor: StepAnchor.DATE_SINISTRE,
    source: SOURCE,
    daysLeft: 5,
    order: 4,
  }),
  declaration: stepViewFixture({
    name: 'Déclarer le sinistre à votre assureur',
    kind: StepKind.DECLARATION,
    anchor: StepAnchor.DATE_PUBLICATION_ARRETE,
    order: 7,
  }),
};

/** An aperçu "arrêté attendu": nothing published yet, hence no deadline. */
export function apercuFixture(
  overrides: Partial<DossierApercu> = {},
): DossierApercu {
  return {
    commune: NIMES,
    risque: APERCU_PARAMS.risque,
    eventDate: APERCU_PARAMS.date,
    status: SinistreStatus.AVANT_ARRETE,
    arrete: null,
    steps: [
      APERCU_STEPS.photos,
      APERCU_STEPS.prevenir,
      APERCU_STEPS.declaration,
    ],
    declarationDeadline: null,
    ...overrides,
  };
}

/** The only request the dossier page sends on load. */
export function mockApercu(page: Page, apercu: DossierApercu) {
  return page.route(`${testApiBaseUrl}/dossier/apercu**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(apercu),
    }),
  );
}
