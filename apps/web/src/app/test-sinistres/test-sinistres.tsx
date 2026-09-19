'use client';

import { useQuery } from '@tanstack/react-query';
import { RequestError } from '@/components/request-error';
import { fetchSinistres } from '@/lib/api/sinistres';
import { queryKeys } from '@/lib/api/keys';
import { useSessionGuard } from '@/lib/api/use-session-guard';

// Test-only route exercising src/lib/api/sinistres.ts in isolation, the same
// way test-requete.tsx exercises the public layer: a client component under
// useSessionGuard is the only way to reach authApiFetch's 401 handling and
// the French error state without a real /sinistres page (docs/plan/sinistre-plan.md,
// Фаза 6).
export function TestSinistres() {
  const status = useSessionGuard();
  const query = useQuery({
    queryKey: queryKeys.sinistres(),
    queryFn: fetchSinistres,
    enabled: status === 'authenticated',
  });

  return (
    <div>
      <p data-testid="session-status">{status}</p>
      {query.data ? (
        <p data-testid="sinistres-count">{query.data.length}</p>
      ) : null}
      {query.isError ? <RequestError /> : null}
    </div>
  );
}
