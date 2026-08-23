import type { CurrentUserResponse } from '@mon-sinistre/contracts';
import { authApiFetch } from './client';

export function fetchCurrentUser() {
  return authApiFetch<CurrentUserResponse>('/auth/me');
}

export function deleteAccount() {
  return authApiFetch<void>('/auth/me', { method: 'DELETE' });
}
