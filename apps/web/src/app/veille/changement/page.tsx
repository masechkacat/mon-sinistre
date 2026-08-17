import type { Metadata } from 'next';
import { Suspense } from 'react';
import { fr } from '@/i18n/fr';
import { VeilleChangement } from './veille-changement';

export const metadata: Metadata = { title: fr.veille.change.page.title };

export default function VeilleChangementPage() {
  return (
    <Suspense>
      <VeilleChangement />
    </Suspense>
  );
}
