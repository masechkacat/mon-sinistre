'use client';

import { useQuery } from '@tanstack/react-query';
import { RequestError } from '@/components/request-error';
import { apiFetch } from '@/lib/api/client';
import { apiBaseUrl } from '@/lib/api/config';
import { queryKeys } from '@/lib/api/keys';

// Test-only route exercising the API layer in isolation: the provider
// connection, the base address read from the environment and the French
// error state — docs/research/web-foundation.md. The retry policy is the
// real one, from providers.tsx, so the tests measure production behaviour.
export function TestRequete() {
  const { status } = useQuery({
    queryKey: queryKeys.health(),
    queryFn: () => apiFetch<{ status: string }>('/health'),
  });

  return (
    <div>
      <p data-testid="query-status">{status}</p>
      <p data-testid="api-base-url">{apiBaseUrl}</p>
      {status === 'error' ? <RequestError /> : null}
    </div>
  );
}
