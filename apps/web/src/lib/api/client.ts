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
  authenticated: boolean,
  retryOn401: boolean,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (authenticated) {
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  // The API is a different origin (`NEXT_PUBLIC_API_URL`), so without this
  // the browser drops the `refresh_token` cookie the API sets on login and
  // ignores the one it clears on logout and account deletion: cross-origin
  // `Set-Cookie` only applies to a request that carried credentials. Every
  // call goes out this way, not just the ones reading the cookie — the login
  // response that *sets* it is an anonymous request.
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && authenticated) {
    // Only a request to an endpoint that requires a session goes through
    // this branch. The gate is the endpoint, not "is a token in memory": a
    // signed-in visitor can reach an anonymous form (browser back to
    // /connexion keeps this module's state alive), and treating that form's
    // 401 as a lost session would retry the failed login — one more attempt
    // against the rate limit — and then navigate away from the error the
    // person needs to read.
    // `retryOn401` gates the refresh attempt only, not the redirect below
    // it — a retried request that still answers 401 (the freshly rotated
    // token itself already invalid) has no second refresh to fall back on
    // and must redirect exactly like an outright failed one.
    if (retryOn401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        return performFetch<T>(path, init, true, false);
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

/**
 * Calls a public endpoint: no access token is sent, and a 401 is the
 * endpoint's own answer — the login form's "identifiants invalides" state, an
 * expired confirmation token — which reaches the caller as an ordinary
 * `ApiError`.
 */
export function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return performFetch<T>(path, init, false, false);
}

/**
 * Calls an endpoint that requires a session: sends the access token, and on a
 * 401 tries one silent refresh before giving up and redirecting to login.
 */
export function authApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return performFetch<T>(path, init, true, true);
}
