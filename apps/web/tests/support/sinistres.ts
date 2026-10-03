import { StepStatus, type Sinistre, type Step } from '@mon-sinistre/contracts';
import { NIMES } from './communes';

/** A plan step; overrides set what a test cares about. */
export function stepFixture(overrides: Partial<Step> = {}): Step {
  return {
    id: 'step',
    sinistreId: SINISTRE_ID_1,
    name: 'Étape',
    description: '',
    plannedDate: null,
    status: StepStatus.A_VENIR,
    completedAt: null,
    fromTemplate: true,
    anchor: null,
    source: null,
    ...overrides,
  };
}

export const SINISTRE_ID_1 = '11111111-1111-1111-1111-111111111111';
export const SINISTRE_ID_2 = '22222222-2222-2222-2222-222222222222';

/** A bare sinistre — the shape `GET /sinistres` lists, before any plan is added. */
export function sinistreFixture(
  overrides: Partial<Record<keyof Sinistre, unknown>> = {},
) {
  return {
    id: SINISTRE_ID_1,
    commune: NIMES,
    risque: 'INONDATION',
    eventDate: '2026-06-15',
    arreteEntryId: null,
    declarationDate: null,
    status: 'AVANT_ARRETE',
    createdAt: '2026-06-16T08:00:00.000Z',
    ...overrides,
  };
}
