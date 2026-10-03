'use client';

import { Combobox } from '@base-ui/react/combobox';
import { Field } from '@base-ui/react/field';
import { XIcon } from 'lucide-react';
import { useRef } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { CommunePopup, isSameCommune } from '@/components/commune-popup';
import { FieldError } from '@/components/field-error';
import {
  inputFrameClassName,
  inputFrameInvalidClassName,
} from '@/components/ui/input';
import { useCommuneSearch } from '@/lib/api/use-commune-search';
import { communeLabel } from '@/lib/commune-label';
import { cn } from '@/lib/utils';
import { fr } from '@/i18n/fr';

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
    useCommuneSearch({ selectedLabel: value && communeLabel(value) });
  // The popup anchors to the whole input group, mirroring
  // CommuneMultiSelect's chips container.
  const fieldRef = useRef<HTMLDivElement>(null);

  // A stale list must not be committable (`searchSettled` in
  // use-commune-search.ts says when it is stale): Enter on it would pick a
  // commune unrelated to what is typed, and here that commune is what the
  // arrêté match and the declaration deadline are computed from. Clearing
  // the field is never stale, so it stays allowed.
  const handleValueChange = (
    next: Commune | null,
    eventDetails: Combobox.Root.ChangeEventDetails,
  ) => {
    if (next !== null && !searchSettled) {
      eventDetails.cancel();
      return;
    }
    onValueChange(next);
  };

  return (
    <Field.Root invalid={Boolean(error)}>
      <Combobox.Root
        id={id}
        autoHighlight
        items={items}
        filteredItems={items}
        value={value}
        onValueChange={handleValueChange}
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
        <CommunePopup
          anchor={fieldRef}
          items={items}
          searchSettled={searchSettled}
        />
      </Combobox.Root>
    </Field.Root>
  );
}
