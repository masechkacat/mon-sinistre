'use client';

import { useQuery } from '@tanstack/react-query';
import { RequestError } from '@/components/request-error';
import { apiFetch } from '@/lib/api/client';
import { apiBaseUrl } from '@/lib/api/config';
import { queryKeys } from '@/lib/api/keys';

// Route de test du slice couvert par la phase 5 : la connexion au provider,
// la lecture de l'adresse depuis l'environnement (tâche 1) et l'affichage
// francisé de l'état d'erreur (tâche 2) — docs/research/web-foundation.md.
export function TestRequete() {
  const { status } = useQuery({
    queryKey: queryKeys.health(),
    queryFn: () => apiFetch<{ status: string }>('/health'),
    retry: false,
  });

  return (
    <div>
      <p data-testid="query-status">{status}</p>
      <p data-testid="api-base-url">{apiBaseUrl}</p>
      {status === 'error' ? <RequestError /> : null}
    </div>
  );
}
