import { useQuery } from '@tanstack/react-query';
import type { Commune } from '@mon-sinistre/contracts';
import { apiFetch } from './client';
import { queryKeys } from './keys';

export function fetchCommunes(q: string) {
  return apiFetch<Commune[]>(`/communes?q=${encodeURIComponent(q)}`);
}

/**
 * The commune an address names by its code alone — a code says nothing to the
 * person reading it. Answered by the search endpoint, which matches an exact
 * code too, so the referential needs no second route; the code is matched
 * again in the answer because a commune name could start with those digits.
 */
export function useCommuneByCode(code: string | undefined, known?: Commune) {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.communes(code ?? ''),
    queryFn: () => fetchCommunes(code ?? ''),
    enabled: Boolean(code),
    initialData: known && [known],
    staleTime: Infinity,
  });

  return {
    commune: data?.find((commune) => commune.codeInsee === code),
    /** A disabled query stays pending: with no code there is nothing to wait for. */
    settled: !code || !isPending,
  };
}
