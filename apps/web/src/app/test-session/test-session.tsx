'use client';

import { fr } from '@/i18n/fr';
import { endSession } from '@/lib/api/session';
import { useSessionGuard } from '@/lib/api/use-session-guard';

// Test-only route exercising the session layer in isolation — access token
// in memory, silent refresh on mount and on bfcache restore, redirect on
// failure (docs/research/user-account.md, «Web: сессия на клиенте»). No
// real protected page exists yet (espace personnel is issue #138); this is
// its guard and its logout call in isolation, ahead of any page built on
// top of them.
export function TestSession() {
  const status = useSessionGuard();

  if (status === 'checking') {
    return <p data-testid="session-status">{fr.session.checking}</p>;
  }

  return (
    <div>
      <p data-testid="protected-content">{fr.session.loggedIn}</p>
      <button type="button" onClick={() => endSession()}>
        {fr.session.logout}
      </button>
    </div>
  );
}
