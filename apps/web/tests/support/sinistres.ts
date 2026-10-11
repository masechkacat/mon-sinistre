import {
  RisqueCatnat,
  SinistreStatus,
  StepKind,
  StepStatus,
  toIsoDate,
  type Sinistre,
  type Step,
  type StepView,
} from '@mon-sinistre/contracts';
import { NIMES } from './communes';

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
