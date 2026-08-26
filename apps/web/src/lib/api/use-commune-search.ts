import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  COMMUNE_SEARCH_MIN_QUERY_LENGTH,
  type Commune,
} from '@mon-sinistre/contracts';
import { apiFetch } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/keys';

// Declared once so `items` keeps its identity between renders with no results.
const NO_ITEMS: Commune[] = [];

const SEARCH_DEBOUNCE_MS = 250;

export interface UseCommuneSearchResult {
  inputValue: string;
  onInputValueChange: (value: string) => void;
  items: Commune[];
  searchSettled: boolean;
}

/**
 * Search over the commune referential, shared by CommuneMultiSelect and
 * CommuneSelect (docs/research/sinistre-plan.md, «Выбор коммуны»): debounce,
 * server-side filtering and `keepPreviousData` live here once so the two
 * components can't drift into two copies of the same request.
 *
 * Each caller still passes `autoHighlight` to its own `Combobox.Root`:
 * without it Base UI clears the highlight every time `items` is replaced, so
 * an answer arriving between ArrowDown and Enter would select nothing.
 */
export function useCommuneSearch(): UseCommuneSearchResult {
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const searchEnabled = query.length >= COMMUNE_SEARCH_MIN_QUERY_LENGTH;

  useEffect(() => {
    const typed = inputValue.trim();
    const timer = setTimeout(() => setQuery(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const { data, isFetching } = useQuery({
    queryKey: queryKeys.communes(query),
    queryFn: () =>
      apiFetch<Commune[]>(`/communes?q=${encodeURIComponent(query)}`),
    enabled: searchEnabled,
    placeholderData: keepPreviousData,
    // The referential is near-static; without this every window refocus and
    // every retype of a cached prefix refires the request.
    staleTime: Infinity,
  });

  const items = searchEnabled ? (data ?? NO_ITEMS) : NO_ITEMS;
  // Until the debounce catches up and the answer for the current query
  // arrives, the popup shows the previous query's results (placeholderData) —
  // a list that does not correspond to what is typed. `data` may also be
  // undefined with fetching over: a failed request, which must not read as
  // « aucune commune trouvée » either.
  const searchSettled =
    searchEnabled &&
    !isFetching &&
    data !== undefined &&
    query === inputValue.trim();

  return {
    inputValue,
    onInputValueChange: setInputValue,
    items,
    searchSettled,
  };
}
