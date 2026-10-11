import {
  isIsoDate,
  type CreateSinistreInput,
  type IsoDate,
  type SinistreConflict,
  type SinistreDetail,
  type SinistreSummary,
  type Step,
  type StepStatus,
} from '@mon-sinistre/contracts';
import { ApiError, authApiFetch } from './client';

export function fetchSinistres() {
  return authApiFetch<SinistreSummary[]>('/sinistres');
}

export function fetchSinistre(id: string) {
  return authApiFetch<SinistreDetail>(`/sinistres/${id}`);
}

/** `null` unmarks the step and gives back its computed status. */
export type StepMark = StepStatus.FAIT | StepStatus.NON_APPLICABLE | null;

export function setSinistreStepStatus(
  sinistreId: string,
  stepId: string,
  status: StepMark,
) {
  return authApiFetch<Step>(`/sinistres/${sinistreId}/etapes/${stepId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export function setSinistreDeclarationDate(
  sinistreId: string,
  declarationDate: IsoDate | null,
) {
  return authApiFetch<SinistreDetail>(`/sinistres/${sinistreId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ declarationDate }),
  });
}

export function deleteSinistre(sinistreId: string) {
  return authApiFetch<void>(`/sinistres/${sinistreId}`, { method: 'DELETE' });
}

/** The answer is the dossier even when the API created nothing: three
 * parameters already used give back the one they belong to. */
export function createSinistre(input: CreateSinistreInput) {
  return authApiFetch<SinistreDetail>('/sinistres', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/**
 * The dossier a `409` from `createSinistre` names, or `null` for any other
 * failure. The shape is checked and not inferred from the status: a `409` from
 * something between the browser and the API carries no dossier to offer.
 */
export function sinistreConflictOf(error: unknown): SinistreConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const { code, existing } = (error.body ?? {}) as Partial<SinistreConflict>;
  const { id, eventDate } = existing ?? {};
  return code === 'DOSSIER_EXISTANT' &&
    typeof id === 'string' &&
    typeof eventDate === 'string' &&
    isIsoDate(eventDate)
    ? { code, existing: { id, eventDate } }
    : null;
}
