import {
  isIsoDate,
  type DossierInput,
  type IsoDate,
  type RisqueCatnat,
} from '@mon-sinistre/contracts';
import { RISQUES, isRisque } from './risques';

/** Code INSEE of the commune, risk and date of the event — a dossier without an account. */
export interface DossierParams {
  commune?: string;
  risque?: RisqueCatnat;
  date?: IsoDate;
}

/**
 * The same three as the API takes them — to save the dossier
 * (`POST /sinistres`) or to carry it through a registration
 * (`POST /auth/register`). `undefined` while any of the three is missing: an
 * incomplete address is not a dossier yet, and a page that already has all
 * three (`Required<DossierParams>`) is answered without that `undefined`.
 */
export function dossierInput(params: Required<DossierParams>): DossierInput;
export function dossierInput(params: DossierParams): DossierInput | undefined;
export function dossierInput(params: DossierParams): DossierInput | undefined {
  const { commune, risque, date } = params;
  return commune && risque && date
    ? { codeInsee: commune, risque, eventDate: date }
    : undefined;
}

export function parseDossierParams(
  searchParams: URLSearchParams,
): DossierParams {
  const commune = searchParams.get('commune') ?? '';
  const risque = searchParams.get('risque') ?? '';
  const date = searchParams.get('date') ?? '';

  return {
    commune: commune === '' ? undefined : commune,
    risque: isRisque(risque) ? risque : undefined,
    date: isIsoDate(date) ? date : undefined,
  };
}

/**
 * The categories the dossier form offers when the address carries no `risque`:
 * those of `risques=A,B`, the parameter the commune answer puts on an arrêté
 * naming several risks. Every category when the list is absent or names
 * nothing known — an arrêté whose wording the classifier does not know yet
 * answers with no category at all, and the choice is then open.
 */
export function parseRisqueOptions(
  searchParams: URLSearchParams,
): readonly RisqueCatnat[] {
  const named = new Set(
    (searchParams.get('risques') ?? '').split(',').filter(isRisque),
  );
  return named.size === 0 ? RISQUES : [...named];
}

/** Shaped like `location.search`: `?…` when there is anything, empty string otherwise. */
export function dossierSearch(params: DossierParams): string {
  const searchParams = new URLSearchParams();
  if (params.commune) {
    searchParams.set('commune', params.commune);
  }
  if (params.risque) {
    searchParams.set('risque', params.risque);
  }
  if (params.date) {
    searchParams.set('date', params.date);
  }

  const query = searchParams.toString();
  return query === '' ? '' : `?${query}`;
}
