import type { Page } from '@playwright/test';
import {
  RisqueCatnat,
  SinistreStatus,
  StepKind,
  StepStatus,
  toIsoDate,
  type CreateSinistreInput,
  type IsoDate,
  type Sinistre,
  type SinistreConflict,
  type SinistreDetail,
  type Step,
  type StepView,
} from '@mon-sinistre/contracts';
import { NIMES } from './communes';
import { testApiBaseUrl } from './env';

export { SOURCE } from '../../src/app/test-plan/cases';

/** A step as an aperçu answers it: no identity and no mark to carry. */
export function stepViewFixture(overrides: Partial<StepView> = {}): StepView {
  return {
    name: 'Étape',
    description: '',
    kind: StepKind.ACTION,
    plannedDate: null,
    status: StepStatus.A_VENIR,
    anchor: null,
    source: null,
    daysLeft: null,
    delay: null,
    order: 1,
    ...overrides,
  };
}

/** The same step stored in a sinistre; overrides set what a test cares about. */
export function stepFixture(overrides: Partial<Step> = {}): Step {
  return {
    ...stepViewFixture(),
    id: 'step',
    sinistreId: SINISTRE_ID_1,
    completedAt: null,
    fromTemplate: true,
    ...overrides,
  };
}

export const SINISTRE_ID_1 = '11111111-1111-1111-1111-111111111111';
export const SINISTRE_ID_2 = '22222222-2222-2222-2222-222222222222';

/** A bare sinistre — the shape `GET /sinistres` lists, before any plan is added. */
export function sinistreFixture(overrides: Partial<Sinistre> = {}): Sinistre {
  return {
    id: SINISTRE_ID_1,
    commune: NIMES,
    risque: RisqueCatnat.INONDATION,
    eventDate: toIsoDate('2026-06-15'),
    arreteEntryId: null,
    declarationDate: null,
    status: SinistreStatus.AVANT_ARRETE,
    createdAt: '2026-06-16T08:00:00.000Z',
    ...overrides,
  };
}

/** The same sinistre as `POST /sinistres` answers it: with its plan, empty
 * here — the specs that care about the plan build their own steps. */
export function sinistreDetailFixture(
  overrides: Partial<SinistreDetail> = {},
): SinistreDetail {
  return {
    ...sinistreFixture(),
    steps: [],
    declarationDeadline: null,
    ...overrides,
  };
}

/** One answer to `POST /sinistres`, in the order a spec expects them. */
export interface CreateReply {
  status: number;
  contentType: string;
  body: string;
  /** Withheld until this resolves — the window where the request is in flight. */
  after?: Promise<void>;
}

/** The dossier itself: `201` for one just created, `200` for one the API
 * answered with instead of creating a second of the same three parameters. */
export function createdReply(id: string, status: number): CreateReply {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(sinistreDetailFixture({ id })),
  };
}

/** The body `SinistresService.create` answers `409` with, verbatim. */
export function conflictReply(id: string, eventDate: IsoDate): CreateReply {
  return {
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'DOSSIER_EXISTANT',
      existing: { id, eventDate },
    } satisfies SinistreConflict),
  };
}

/**
 * Answers `POST /sinistres` from `replies` in order and gives back the array
 * of bodies sent: a conflict and the request that answers it hit the same
 * endpoint, told apart only by their place in the sequence.
 */
export async function mockCreateSinistre(page: Page, replies: CreateReply[]) {
  const sent: CreateSinistreInput[] = [];
  await page.route(`${testApiBaseUrl}/sinistres`, async (route) => {
    sent.push(
      JSON.parse(route.request().postData() ?? '{}') as CreateSinistreInput,
    );
    const { after, ...answer } =
      replies[Math.min(sent.length - 1, replies.length - 1)];
    await after;
    return route.fulfill(answer);
  });
  return sent;
}
