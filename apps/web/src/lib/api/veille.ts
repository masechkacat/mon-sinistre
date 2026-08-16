import { VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { apiFetch } from './client';

// Shared by the confirmer page's button and the one-click route handler
// (src/app/veille/desinscription/route.ts) — both call the same endpoint.
export function unsubscribeVeille(token: string) {
  return apiFetch<void>(VEILLE_UNSUBSCRIBE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}
