'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { apiBaseUrl } from '@/lib/api/config';
import { queryKeys } from '@/lib/api/keys';

// Route de test du seul slice couvert par la phase 5, tâche 1 : la connexion
// au provider et la lecture de l'adresse depuis l'environnement. L'affichage
// francisé de l'état d'erreur (rôle alert) arrive avec la tâche 2 du plan,
// sur cette même route — docs/research/web-foundation.md.
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
    </div>
  );
}
