import type { DossierApercu } from '@mon-sinistre/contracts';
import type { DossierParams } from '../dossier-params';
import { apiFetch } from './client';

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
