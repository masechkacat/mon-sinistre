'use client';

import { Combobox } from '@base-ui/react/combobox';
import { Field } from '@base-ui/react/field';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  COMMUNE_SEARCH_MIN_QUERY_LENGTH,
  VEILLE_MAX_COMMUNES,
  type Commune,
} from '@mon-sinistre/contracts';
import { apiFetch } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/keys';
import { cn } from '@/lib/utils';
import { fr } from '@/i18n/fr';

// Declared once so `items` keeps its identity between renders with no results.
const NO_ITEMS: Commune[] = [];

const SEARCH_DEBOUNCE_MS = 250;

const isSameCommune = (a: Commune, b: Commune) => a.codeInsee === b.codeInsee;
const communeLabel = (commune: Commune) =>
  `${commune.name} (${commune.departementName})`;

export interface CommuneMultiSelectProps {
  value: Commune[];
  onValueChange: (value: Commune[]) => void;
  id?: string;
  error?: string;
}

/**
 * Multi-select search over the commune referential — Base UI Combobox
 * (docs/research/veille-subscription-lifecycle.md, «Страницы web и форма
 * подписки»): server-side filtering via `filteredItems`, the ceiling is
 * enforced here because the primitive has no notion of a selection limit.
 *
 * `autoHighlight` is what makes the keyboard work with a server-filtered list:
 * without it Base UI clears the highlight every time the items are replaced,
 * so an answer arriving between ArrowDown and Enter selected nothing.
 */
export function CommuneMultiSelect({
  value,
  onValueChange,
  id,
  error,
}: CommuneMultiSelectProps) {
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
  });

  const items = searchEnabled ? (data ?? NO_ITEMS) : NO_ITEMS;

  const ceilingReached = value.length >= VEILLE_MAX_COMMUNES;
  // The popup anchors to the whole field, not to the input: the input starts
  // after the chips, and the list would hang off to the right of them.
  const fieldRef = useRef<HTMLDivElement>(null);

  const handleValueChange = (next: Commune[]) => {
    if (next.length > VEILLE_MAX_COMMUNES) return;
    onValueChange(next);
  };

  return (
    <Field.Root invalid={Boolean(error)}>
      <Combobox.Root
        id={id}
        multiple
        autoHighlight
        items={items}
        filteredItems={items}
        value={value}
        onValueChange={handleValueChange}
        inputValue={inputValue}
        onInputValueChange={setInputValue}
        itemToStringLabel={communeLabel}
        isItemEqualToValue={isSameCommune}
      >
        {/* Field.Label, not Combobox.Label: the latter labels Combobox.Trigger,
            and the form control here is Combobox.Input. */}
        <Field.Label className="mb-1.5 block text-sm font-medium">
          {fr.veille.form.communesLabel}
        </Field.Label>
        <Combobox.Chips
          ref={fieldRef}
          className={cn(
            'flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
            error &&
              'border-destructive ring-3 ring-destructive/20 dark:ring-destructive/40',
          )}
        >
          {value.map((commune) => (
            <Combobox.Chip
              key={commune.codeInsee}
              className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-sm text-foreground"
            >
              {commune.name}
              <Combobox.ChipRemove
                aria-label={fr.veille.form.removeCommune(commune.name)}
                className="flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XIcon className="size-3.5" aria-hidden />
              </Combobox.ChipRemove>
            </Combobox.Chip>
          ))}
          <Combobox.Input
            placeholder={fr.veille.form.communesPlaceholder}
            className="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </Combobox.Chips>
        {error ? (
          <Field.Error
            match
            role="alert"
            className="mt-1.5 text-sm text-destructive"
          >
            {error}
          </Field.Error>
        ) : null}
        <Combobox.Status
          className="sr-only"
          data-testid="commune-search-status"
        >
          {searchEnabled && !isFetching && query === inputValue.trim()
            ? fr.veille.form.communesFound(items.length)
            : null}
        </Combobox.Status>
        {/* Visible and announced: pressing Enter on a 21st commune does
            nothing, and silence reads as a broken field. */}
        {ceilingReached ? (
          <p role="status" className="mt-1.5 text-sm text-muted-foreground">
            {fr.veille.form.maxCommunesReached(VEILLE_MAX_COMMUNES)}
          </p>
        ) : null}
        <Combobox.Portal>
          <Combobox.Positioner
            anchor={fieldRef}
            className="z-50"
            sideOffset={4}
          >
            <Combobox.Popup className="max-h-64 w-(--anchor-width) overflow-auto rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-md">
              <Combobox.Empty className="px-3 py-2 text-sm text-muted-foreground">
                {fr.veille.form.noCommuneFound}
              </Combobox.Empty>
              <Combobox.List>
                {(commune: Commune) => (
                  <Combobox.Item
                    key={commune.codeInsee}
                    value={commune}
                    className="flex cursor-default items-center justify-between gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground"
                  >
                    {communeLabel(commune)}
                    {/* An already selected commune stays in the list, where
                        Enter would remove it again — the mark says so. */}
                    <Combobox.ItemIndicator>
                      <CheckIcon className="size-4" aria-hidden />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </Field.Root>
  );
}
