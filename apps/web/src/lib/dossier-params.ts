import { RisqueCatnat, isIsoDate, type IsoDate } from '@mon-sinistre/contracts';

/** Code INSEE of the commune, risk and date of the event — a dossier without an account. */
export interface DossierParams {
  commune?: string;
  risque?: RisqueCatnat;
  date?: IsoDate;
}

const RISQUES: readonly string[] = Object.values(RisqueCatnat);

export function parseDossierParams(
  searchParams: URLSearchParams,
): DossierParams {
  const commune = searchParams.get('commune') ?? '';
  const risque = searchParams.get('risque') ?? '';
  const date = searchParams.get('date') ?? '';

  return {
    commune: commune === '' ? undefined : commune,
    risque: RISQUES.includes(risque) ? (risque as RisqueCatnat) : undefined,
    date: isIsoDate(date) ? date : undefined,
  };
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
