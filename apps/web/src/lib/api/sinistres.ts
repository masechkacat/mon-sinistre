import type {
  IsoDate,
  RisqueCatnat,
  SinistreDetail,
  SinistreSummary,
} from '@mon-sinistre/contracts';
import { authApiFetch } from './client';

export function fetchSinistres() {
  return authApiFetch<SinistreSummary[]>('/sinistres');
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
