import type { RemindersPreference } from '@mon-sinistre/contracts';
import { apiFetch, authApiFetch } from './client';

// Literal API routes, unlike `unsubscribeVeille`: `REMINDER_UNSUBSCRIBE_PATH`
// is the page the mail links to, not the endpoint behind it — for veille the
// two happen to coincide.

export function unsubscribeReminders(token: string) {
  return apiFetch<void>('/rappels/desinscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export function updateReminders(enabled: boolean) {
  return authApiFetch<RemindersPreference>('/rappels', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled } satisfies RemindersPreference),
  });
}
