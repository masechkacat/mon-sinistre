import type { LoginResponse } from '@mon-sinistre/contracts';
import { apiBaseUrl } from './config';

/**
 * Where the session guard sends people once a silent refresh comes back
 * empty-handed. Not a contracts path — no mail carries this address, only
 * the client links to it — and the page itself does not exist yet:
 * src/app/connexion/page.tsx lands with the login screen (issue #136).
 */
export const LOGIN_PATH = '/connexion';

const REFRESH_PATH = '/auth/refresh';
const LOGOUT_PATH = '/auth/logout';

// Module-level, not React state (in-memory choice — docs/research/user-account.md,
// «Web: сессия на клиенте»): every caller across the app — apiFetch's 401
// handler, the page guard, a future header widget — reads and writes the
// same value without a provider. This module must never be imported for its
// mutations from server-executed code (a Route Handler, a Server Component)
// — Node keeps the module instance alive across requests, so a value set
// there would leak between people; every setter here is reached only from
// 'use client' code running in the browser.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

let refreshInFlight: Promise<boolean> | null = null;

async function requestRefresh(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl}${REFRESH_PATH}`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      clearAccessToken();
      return false;
    }
    const body = (await response.json()) as LoginResponse;
    setAccessToken(body.accessToken);
    return true;
  } catch {
    clearAccessToken();
    return false;
  }
}

/**
 * Silent refresh: the httpOnly `refresh_token` cookie is the only
 * credential sent (`credentials: 'include'`), the response carries a fresh
 * access token in its body. Raw `fetch`, not `apiFetch` — `apiFetch` calls
 * this function on a 401 of its own, and routing it back through `apiFetch`
 * would recurse the moment the refresh endpoint itself ever answered 401.
 * Concurrent callers (the page guard on mount racing a 401 retry from an
 * in-flight query, two requests firing at once) share one in-flight call
 * instead of each rotating the cookie themselves — only one of several
 * racing rotations would still be valid afterwards.
 */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = requestRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * A session confirmed lost — a failed silent refresh, or an authenticated
 * request's 401 that a refresh could not recover. `window.location.assign`,
 * not the Next.js router: a router navigation keeps the whole client-side
 * app — and its module state — alive, and `assign` (unlike `replace`) keeps
 * the page being left in session history, so the browser's own back button
 * still lands on it — the guard on that page then has to answer for it
 * again, including on the bfcache restore path (`useSessionGuard`).
 */
export function redirectToLogin(): void {
  clearAccessToken();
  window.location.assign(LOGIN_PATH);
}

/**
 * Ends the session everywhere: revokes the refresh cookie server-side (best
 * effort — a network failure here must not strand the person on a screen
 * that still looks logged in) before falling back to the same redirect as
 * an ordinary lost session.
 */
export async function endSession(): Promise<void> {
  try {
    await fetch(`${apiBaseUrl}${LOGOUT_PATH}`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Best effort — see docblock above.
  }
  redirectToLogin();
}
