'use client';

import { Combobox } from '@base-ui/react/combobox';
import { Field } from '@base-ui/react/field';
import { CheckIcon, XIcon } from 'lucide-react';
import { useRef } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { FieldError } from '@/components/field-error';
import {
  inputFrameClassName,
  inputFrameInvalidClassName,
} from '@/components/ui/input';
import { useCommuneSearch } from '@/lib/api/use-commune-search';
import { communeLabel } from '@/lib/commune-label';
import { cn } from '@/lib/utils';
import { fr } from '@/i18n/fr';

const isSameCommune = (a: Commune, b: Commune) => a.codeInsee === b.codeInsee;

export interface CommuneSelectProps {
  value: Commune | null;
  onValueChange: (value: Commune | null) => void;
  label: string;
  id?: string;
  error?: string;
}

/**
 * Single-selection counterpart to CommuneMultiSelect. Search behaviour is
 * `useCommuneSearch`.
 */
export function CommuneSelect({
  value,
  onValueChange,
  label,
  id,
  error,
}: CommuneSelectProps) {
  const { inputValue, onInputValueChange, items, searchSettled } =
    useCommuneSearch();
  // The popup anchors to the whole input group, mirroring
  // CommuneMultiSelect's chips container.
  const fieldRef = useRef<HTMLDivElement>(null);

  return (
    <Field.Root invalid={Boolean(error)}>
      <Combobox.Root
        id={id}
        autoHighlight
        items={items}
        filteredItems={items}
        value={value}
        onValueChange={onValueChange}
        inputValue={inputValue}
        onInputValueChange={onInputValueChange}
        itemToStringLabel={communeLabel}
        isItemEqualToValue={isSameCommune}
      >
        <Field.Label className="mb-1.5 block text-sm font-medium">
          {label}
        </Field.Label>
        <Combobox.InputGroup
          ref={fieldRef}
          className={cn(
            inputFrameClassName,
            'flex items-center gap-1.5 px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
            error && inputFrameInvalidClassName,
          )}
        >
          <Combobox.Input
            placeholder={fr.commune.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Combobox.Clear
            aria-label={fr.commune.clearSelection}
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-3.5" aria-hidden />
          </Combobox.Clear>
        </Combobox.InputGroup>
        <FieldError error={error} className="mt-1.5" />
        {/* Announces the committed selection. Options are already read while
            the list is open, so this stays quiet during the search itself and
            only reports the outcome — talking over the list's own reading
            would repeat what the user just heard. Pre-mounted live region:
            only the text toggles. */}
        <p
          role="status"
          data-testid="commune-selected-status"
          className="sr-only"
        >
          {value ? fr.commune.selected(communeLabel(value)) : null}
        </p>
        <Combobox.Portal>
          <Combobox.Positioner
            anchor={fieldRef}
            className="z-50"
            sideOffset={4}
          >
            {/* The chrome goes with the content: while the popup has nothing
                to show (search pending, nothing settled) an empty bordered
                strip would hang under the field. */}
            <Combobox.Popup
              className={cn(
                'max-h-64 w-(--anchor-width) overflow-auto rounded-lg bg-popover text-popover-foreground',
                (items.length > 0 || searchSettled) &&
                  'border border-border py-1 shadow-md',
              )}
            >
              <Combobox.Empty
                className={cn(
                  'text-sm text-muted-foreground',
                  searchSettled && 'px-3 py-2',
                )}
              >
                {searchSettled ? fr.commune.noneFound : null}
              </Combobox.Empty>
              <Combobox.List>
                {(commune: Commune) => (
                  <Combobox.Item
                    key={commune.codeInsee}
                    value={commune}
                    className="flex cursor-default items-center justify-between gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground"
                  >
                    {communeLabel(commune)}
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
