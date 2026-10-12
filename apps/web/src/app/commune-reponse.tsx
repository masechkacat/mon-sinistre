'use client';

import { useState } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { CommuneSelect } from '@/components/commune-select';
import { ReponseCommune } from '@/components/reponse-commune';
import { fr } from '@/i18n/fr';

/** The question the home page opens with, and the answer right under it. */
export function CommuneReponse() {
  const [commune, setCommune] = useState<Commune | null>(null);

  return (
    <div className="space-y-8">
      <CommuneSelect
        value={commune}
        onValueChange={setCommune}
        label={fr.home.communeLabel}
      />
      <ReponseCommune commune={commune} />
    </div>
  );
}
