'use client';

import { Combobox } from '@base-ui/react/combobox';
import { CheckIcon } from 'lucide-react';
import type { RefObject } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { communeLabel } from '@/lib/commune-label';
import { cn } from '@/lib/utils';
import { fr } from '@/i18n/fr';

export const isSameCommune = (a: Commune, b: Commune) =>
  a.codeInsee === b.codeInsee;

export interface CommunePopupProps {
  anchor: RefObject<HTMLElement | null>;
  items: Commune[];
  searchSettled: boolean;
}

/**
 * The list under a commune combobox, shared by CommuneSelect and
 * CommuneMultiSelect; `items` and `searchSettled` come from `useCommuneSearch`.
 */
export function CommunePopup({
  anchor,
  items,
  searchSettled,
}: CommunePopupProps) {
  return (
    <Combobox.Portal>
      <Combobox.Positioner anchor={anchor} className="z-50" sideOffset={4}>
        {/* The chrome goes with the content: while the popup has nothing to
            show (search pending, nothing settled) an empty bordered strip
            would hang under the field. */}
        <Combobox.Popup
          data-surface="papier"
          className={cn(
            'max-h-64 w-(--anchor-width) overflow-auto rounded-lg bg-popover text-popover-foreground',
            (items.length > 0 || searchSettled) &&
              'border border-border py-1 shadow-md',
          )}
        >
          {/* Only a settled search may claim there is nothing: below the
              minimum query length, during the debounce and while a fetch is
              in flight, the message would describe a search that never ran.
              Pre-mounted live region (Base UI docs: toggle the children, not
              the node). */}
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
  );
}
