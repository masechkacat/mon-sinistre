import { apiBaseUrl } from './config';
import { getAccessToken, redirectToLogin, refreshSession } from './session';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
  ) {
    super(`API error ${status} on ${path}`);
    this.name = 'ApiError';
  }
}

async function performFetch<T>(
  path: string,
  init: RequestInit | undefined,
  retryOn401: boolean,
): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });

  if (response.status === 401 && token) {
    // Only a request that carried a token goes through this branch: an
    // anonymous call (login, register, a public GET) answering 401 is the
    // endpoint's own business — the login form's "identifiants invalides"
    // state, not a lost session — and must reach the caller as an ordinary
    // ApiError instead. `retryOn401` gates the refresh attempt only, not the
    // redirect below it — a retried request that still answers 401 (the
    // freshly rotated token itself already invalid) has no second refresh to
    // fall back on and must redirect exactly like an outright failed one.
    if (retryOn401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        return performFetch<T>(path, init, false);
      }
    }
    redirectToLogin();
    throw new ApiError(response.status, path);
  }

  if (!response.ok) {
    throw new ApiError(response.status, path);
  }
  // A bodyless success (204/205 — deletions, unsubscribes) is still a success:
  // response.json() would reject on the empty body and surface as an error.
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return performFetch<T>(path, init, true);
}
