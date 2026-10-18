'use client';

import { useState } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { CommuneSelect } from '@/components/commune-select';
import { CommuneAnswer } from '@/components/commune-answer';
import { fr } from '@/i18n/fr';

/** The question the home page opens with, and the answer right under it. */
export function CommuneLookup() {
  const [commune, setCommune] = useState<Commune | null>(null);

  return (
    <div className="space-y-8">
      <CommuneSelect
        value={commune}
        onValueChange={setCommune}
        label={fr.home.communeLabel}
      />
      <CommuneAnswer commune={commune} />
    </div>
  );
}
