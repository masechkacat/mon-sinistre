'use client';

import { useState } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { CommuneSelect } from '@/components/commune-select';

export function TestCommuneSelect() {
  const [value, setValue] = useState<Commune | null>(null);

  return (
    <div className="p-8">
      <CommuneSelect label="Commune" value={value} onValueChange={setValue} />
      <p data-testid="selected-code">{value?.codeInsee ?? ''}</p>
    </div>
  );
}
