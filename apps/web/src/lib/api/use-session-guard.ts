'use client';

import { useEffect, useState } from 'react';
import { getAccessToken, redirectToLogin, refreshSession } from './session';

export type SessionGuardStatus = 'checking' | 'authenticated';

/**
 * Protects a client page: children render only once a live session is
 * confirmed. Runs the check twice for two different reasons a component
 * mount alone would miss:
 *
 * - On mount, unconditionally — a hard reload loses the in-memory access
 *   token, so the refresh cookie is the only proof of a session left.
 * - On every `pageshow` with `persisted: true` — Chrome's bfcache freezes a
 *   page's JS state (and whatever it had already painted) instead of
 *   tearing it down, so a same-document effect never reruns on restore; a
 *   page frozen mid-render, with protected content still in the DOM, would
 *   otherwise flash it straight back on the browser's own "back" button. A
 *   fresh `pageshow` is the only signal that fires on that path.
 */
export function useSessionGuard(): SessionGuardStatus {
  const [status, setStatus] = useState<SessionGuardStatus>(
    getAccessToken() ? 'authenticated' : 'checking',
  );

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (getAccessToken()) {
        setStatus('authenticated');
        return;
      }
      setStatus('checking');
      const ok = await refreshSession();
      if (cancelled) return;
      if (ok) {
        setStatus('authenticated');
      } else {
        redirectToLogin();
      }
    }

    check();

    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) check();
    }
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  return status;
}
