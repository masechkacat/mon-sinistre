import type { Metadata } from 'next';
import { Suspense } from 'react';
import { fr } from '@/i18n/fr';
import { DossierApercuView } from './dossier-apercu';

export const metadata: Metadata = { title: fr.dossier.page.title };

export default function DossierPage() {
  return (
    <Suspense>
      <DossierApercuView />
    </Suspense>
  );
}
