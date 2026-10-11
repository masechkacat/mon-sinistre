import type { Route } from 'next';
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
 * `undefined` while any of the three is missing: an incomplete address is not
 * a dossier yet. The overload spares a page that already holds all three a
 * check that cannot fail.
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

/**
 * The address of a dossier the commune answer links to: the three parameters,
 * plus the categories to choose from when the arrêté named several and
 * `risque` is therefore left out — `parseRisqueOptions` reads them back.
 */
export interface DossierLink extends DossierParams {
  risques?: readonly RisqueCatnat[];
}

/** Shaped like `location.search`: `?…` when there is anything, empty string otherwise. */
export function dossierSearch(params: DossierLink): string {
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
  if (params.risques && params.risques.length > 0) {
    searchParams.set('risques', params.risques.join(','));
  }

  const query = searchParams.toString();
  return query === '' ? '' : `?${query}`;
}

export type DossierPage = '/dossier' | '/inscription' | '/connexion';

/** The pages a dossier travels between, each one carrying it in the address. */
export function dossierPath(page: DossierPage, params: DossierLink): Route {
  // typedRoutes cannot check a query built at runtime.
  return `${page}${dossierSearch(params)}` as Route;
}
