'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { CommuneMultiSelect } from '@/components/commune-multi-select';

// Distinct codes so CommuneMultiSelect's isItemEqualToValue never collapses
// two of them — only used to pre-fill the ceiling test (issue #72).
function fabricatedCommunes(count: number): Commune[] {
  return Array.from({ length: count }, (_, index) => ({
    codeInsee: String(index).padStart(5, '0'),
    name: `Commune ${index}`,
    departementCode: '00',
    departementName: 'Département test',
  }));
}

export function TestCommunes() {
  const searchParams = useSearchParams();
  const preselected = Number(searchParams.get('preselected') ?? '0');
  const [value, setValue] = useState<Commune[]>(() =>
    fabricatedCommunes(preselected),
  );

  return (
    <div className="p-8">
      <CommuneMultiSelect value={value} onValueChange={setValue} />
      <p data-testid="selected-count">{value.length}</p>
    </div>
  );
}
