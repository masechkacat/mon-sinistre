import { useQueryClient } from '@tanstack/react-query';
import type {
  CommuneArretes,
  DossierApercu,
  DossierInput,
} from '@mon-sinistre/contracts';
import type { DossierParams } from '../dossier-params';
import { apiFetch } from './client';
import { useCommuneByCode } from './communes';
import { queryKeys } from './keys';

/**
 * The plan the three parameters would get as a sinistre, computed and not
 * stored. Public endpoint: the aperçu belongs to nobody yet. The query names
 * are the API's (`CreateSinistreDto`), not the shorter ones of the address.
 */
export function fetchDossierApercu({
  commune,
  risque,
  date,
}: Required<DossierParams>) {
  const query = new URLSearchParams({
    codeInsee: commune,
    risque,
    eventDate: date,
  });
  return apiFetch<DossierApercu>(`/dossier/apercu?${query.toString()}`);
}

export function fetchCommuneArretes(code: string) {
  const query = new URLSearchParams({ codeInsee: code });
  return apiFetch<CommuneArretes>(`/dossier/arretes?${query.toString()}`);
}

export function useDossierCommune(dossier: DossierInput) {
  const apercu = useQueryClient().getQueryData<DossierApercu>(
    queryKeys.dossierApercu(
      dossier.codeInsee,
      dossier.risque,
      dossier.eventDate,
    ),
  );
  return useCommuneByCode(dossier.codeInsee, apercu?.commune);
}
