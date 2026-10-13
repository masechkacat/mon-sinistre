'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getAccessToken,
  refreshSession,
  subscribeAccessToken,
} from './session';

export type SessionStatus = 'checking' | 'authenticated' | 'anonymous';

/**
 * The session as something merely showing it sees it — a header, a widget:
 * unlike `useSessionGuard`, a missing session is an answer here, not a
 * redirect, and nothing is withheld while the answer is on its way.
 *
 * Every consumer on the page shares the one silent refresh of the page load
 * and then follows the token itself, so a login or a logout elsewhere in the
 * app is picked up without a request of its own.
 */
export function useSession(): SessionStatus {
  const token = useSyncExternalStore(
    subscribeAccessToken,
    getAccessToken,
    () => null,
  );
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!getAccessToken()) await refreshSession();
      if (!cancelled) setAnswered(true);
    }

    check();

    return () => {
      cancelled = true;
    };
  }, []);

  if (token) return 'authenticated';
  return answered ? 'anonymous' : 'checking';
}
