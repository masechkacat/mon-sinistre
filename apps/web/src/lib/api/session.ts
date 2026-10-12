import type { Route } from 'next';
import type { LoginResponse } from '@mon-sinistre/contracts';
import { apiBaseUrl } from './config';

/**
 * Where the session guard sends people once a silent refresh comes back
 * empty-handed. Not a contracts path — no mail carries this address, only
 * the client links to it (`src/app/connexion/`).
 */
export const LOGIN_PATH = '/connexion';

export const ESPACE_PERSONNEL_PATH = '/espace-personnel';

export const LOGIN_NEXT_PARAM = 'suivant';

/** The login address that comes back to `path` once the session is open. */
export function loginPathWithNext(path: string): Route {
  const search = new URLSearchParams({ [LOGIN_NEXT_PARAM]: path });
  return `${LOGIN_PATH}?${search}` as Route;
}

export function loginPathToSinistre(sinistreId: string | undefined): Route {
  return sinistreId
    ? loginPathWithNext(`/sinistres/${sinistreId}`)
    : LOGIN_PATH;
}

/** Any origin will do, as long as resolving against it is the only way to
 * reach it: `.invalid` is reserved and resolves nowhere. */
const SAME_ORIGIN = 'https://interne.invalid';

/**
 * Where the address asks to go after the login — a path inside the app, or
 * `null` for anything else. The value is read by the very parser that would
 * carry the navigation rather than matched as text: `//evil.example` is a
 * protocol-relative URL, `/\evil.example` is one too (`\` reads as `/` in an
 * http address), and `/%09/evil.example` becomes one once the tab is dropped
 * — three spellings of another host that all look like a path. What comes
 * back is the parser's own reading of the value, so that what was checked is
 * what gets navigated to.
 */
export function loginNextPath(searchParams: URLSearchParams): Route | null {
  const next = searchParams.get(LOGIN_NEXT_PARAM) ?? '';
  if (!next.startsWith('/')) return null;
  try {
    const url = new URL(next, SAME_ORIGIN);
    const path = `${url.pathname}${url.search}${url.hash}`;
    // The reading is checked again after it was read: `/..//evil.example`
    // resolves inside the origin, and its dot segment leaves a path that is
    // protocol-relative all over again.
    return url.origin === SAME_ORIGIN && !path.startsWith('//')
      ? (path as Route)
      : null;
  } catch {
    return null;
  }
}

/** Exported for the mocks that stand in for the API in `tests/support/`. */
export const REFRESH_PATH = '/auth/refresh';
const LOGOUT_PATH = '/auth/logout';

// Module-level, not React state (in-memory choice — docs/research/user-account.md,
// «Web: сессия на клиенте»): every caller across the app — apiFetch's 401
// handler, the page guard, the session widgets (use-session.ts) — reads and writes the
// same value without a provider. This module must never be imported for its
// mutations from server-executed code (a Route Handler, a Server Component)
// — Node keeps the module instance alive across requests, so a value set
// there would leak between people; every setter here is reached only from
// 'use client' code running in the browser.
let accessToken: string | null = null;

const accessTokenListeners = new Set<(token: string | null) => void>();

export function subscribeAccessToken(
  listener: (token: string | null) => void,
): () => void {
  accessTokenListeners.add(listener);
  return () => {
    accessTokenListeners.delete(listener);
  };
}

function notifyAccessToken(): void {
  for (const listener of accessTokenListeners) listener(accessToken);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
  notifyAccessToken();
}

export function clearAccessToken(): void {
  accessToken = null;
  notifyAccessToken();
}

/**
 * What a silent refresh found: a session, none (the API refused the cookie),
 * or no answer at all — a request that failed says nothing about the cookie,
 * and a person holding a valid one must not be taken for a stranger.
 */
export type RefreshOutcome = 'open' | 'none' | 'failed';

let refreshInFlight: Promise<RefreshOutcome> | null = null;

async function requestRefresh(): Promise<RefreshOutcome> {
  try {
    const response = await fetch(`${apiBaseUrl}${REFRESH_PATH}`, {
      method: 'POST',
      credentials: 'include',
    });
    if (response.ok) {
      const body = (await response.json()) as LoginResponse;
      setAccessToken(body.accessToken);
      return 'open';
    }
    clearAccessToken();
    return response.status === 401 ? 'none' : 'failed';
  } catch {
    clearAccessToken();
    return 'failed';
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
export function refreshSession(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = requestRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * Drops the in-memory access token and leaves the client-side app entirely
 * via `window.location.assign`, not the Next.js router: a router navigation
 * keeps the whole app — and its module state — alive, and `assign` (unlike
 * `replace`) keeps the page being left in session history, so the browser's
 * own back button still lands on it — the guard on that page then has to
 * answer for it again, including on the bfcache restore path
 * (`useSessionGuard`). Shared by every path that ends a session outright:
 * a lost session redirecting to login, account deletion redirecting to its
 * public confirmation page (`espace-personnel.tsx`).
 */
export function clearSessionAndNavigate(path: string): void {
  clearAccessToken();
  window.location.assign(path);
}

/**
 * A session confirmed lost — a failed silent refresh, or an authenticated
 * request's 401 that a refresh could not recover. The login comes back to the
 * page that lost it.
 */
export function redirectToLogin(): void {
  const { pathname, search } = window.location;
  // The login page loses a session too — saving the dossier of its address
  // once logged in — and that address already says where to go next.
  clearSessionAndNavigate(
    pathname === LOGIN_PATH
      ? `${pathname}${search}`
      : loginPathWithNext(`${pathname}${search}`),
  );
}

/**
 * Ends the session everywhere: revokes the refresh cookie server-side (best
 * effort — a network failure here must not strand the person on a screen
 * that still looks logged in) before leaving for the login page.
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
  clearSessionAndNavigate(LOGIN_PATH);
}
