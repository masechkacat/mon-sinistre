import type { CurrentUserResponse } from '@mon-sinistre/contracts';
import { apiFetch } from './client';

export function fetchCurrentUser() {
  return apiFetch<CurrentUserResponse>('/auth/me');
}

export function deleteAccount() {
  return apiFetch<void>('/auth/me', { method: 'DELETE' });
}
