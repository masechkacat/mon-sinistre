import { VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { apiFetch } from './client';

// Trimmed here, not by the caller: the request carries the address the form
// validated, and every form offering the subscription sends the same one.
export function subscribeVeille(email: string, communeCodes: string[]) {
  return apiFetch<void>('/veille', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), communeCodes }),
  });
}

// Shared by the confirmer page's button and the one-click route handler
// (src/app/veille/desinscription/route.ts) — both call the same endpoint.
export function unsubscribeVeille(token: string) {
  return apiFetch<void>(VEILLE_UNSUBSCRIBE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}
