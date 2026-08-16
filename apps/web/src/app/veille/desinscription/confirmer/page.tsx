import type { Metadata } from 'next';
import { Suspense } from 'react';
import { fr } from '@/i18n/fr';
import { VeilleDesinscriptionConfirmer } from './veille-desinscription-confirmer';

export const metadata: Metadata = {
  title: fr.veille.desinscription.confirmer.page.title,
};

export default function VeilleDesinscriptionConfirmerPage() {
  return (
    <Suspense>
      <VeilleDesinscriptionConfirmer />
    </Suspense>
  );
}
