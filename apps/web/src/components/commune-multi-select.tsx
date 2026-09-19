'use client';

import { Combobox } from '@base-ui/react/combobox';
import { Field } from '@base-ui/react/field';
import { CheckIcon, XIcon } from 'lucide-react';
import { useRef } from 'react';
import { VEILLE_MAX_COMMUNES, type Commune } from '@mon-sinistre/contracts';
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
 * Search behaviour is `useCommuneSearch`.
 */
export function CommuneMultiSelect({
  value,
  onValueChange,
  id,
  error,
}: CommuneMultiSelectProps) {
  const { inputValue, onInputValueChange, items, searchSettled } =
    useCommuneSearch();
  const ceilingReached = value.length >= VEILLE_MAX_COMMUNES;
  // The popup anchors to the whole field, not to the input: the input starts
  // after the chips, and the list would hang off to the right of them.
  const fieldRef = useRef<HTMLDivElement>(null);

  // cancel() stops Base UI's own follow-up to a refused selection — without
  // it the primitive still clears the input and closes the popup.
  const handleValueChange = (
    next: Commune[],
    eventDetails: Combobox.Root.ChangeEventDetails,
  ) => {
    if (next.length > VEILLE_MAX_COMMUNES) {
      eventDetails.cancel();
      return;
    }
    // While the list is stale, Enter would add a commune unrelated to what is
    // typed; additions wait for the current answer, removals stay possible.
    if (!searchSettled && next.length > value.length) {
      eventDetails.cancel();
      return;
    }
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
        onInputValueChange={onInputValueChange}
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
            inputFrameClassName,
            'flex flex-wrap items-center gap-1.5 px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
            error && inputFrameInvalidClassName,
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
        <FieldError error={error} className="mt-1.5" />
        <Combobox.Status
          className="sr-only"
          data-testid="commune-search-status"
        >
          {searchSettled ? fr.veille.form.communesFound(items.length) : null}
        </Combobox.Status>
        {/* Visible and announced: pressing Enter on a 21st commune does
            nothing, and silence reads as a broken field. Pre-mounted live
            region — only the text toggles. */}
        <p
          role="status"
          className={cn(
            'text-sm text-muted-foreground',
            ceilingReached && 'mt-1.5',
          )}
        >
          {ceilingReached
            ? fr.veille.form.maxCommunesReached(VEILLE_MAX_COMMUNES)
            : null}
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
              {/* Only a settled search may claim there is nothing: below the
                  minimum query length, during the debounce and while a fetch
                  is in flight, the message would describe a search that never
                  ran. Pre-mounted live region (Base UI docs: toggle the
                  children, not the node). */}
              <Combobox.Empty
                className={cn(
                  'text-sm text-muted-foreground',
                  searchSettled && 'px-3 py-2',
                )}
              >
                {searchSettled ? fr.veille.form.noCommuneFound : null}
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
