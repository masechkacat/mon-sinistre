import type {
  IsoDate,
  RisqueCatnat,
  SinistreDetail,
  SinistreSummary,
  Step,
  StepStatus,
} from '@mon-sinistre/contracts';
import { authApiFetch } from './client';

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

export interface CreateSinistreInput {
  codeInsee: string;
  risque: RisqueCatnat;
  eventDate: IsoDate;
}

// Consumed by the /sinistres/nouveau page (docs/plan/sinistre-plan.md, Фаза 6).
export function createSinistre(input: CreateSinistreInput) {
  return authApiFetch<SinistreDetail>('/sinistres', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
