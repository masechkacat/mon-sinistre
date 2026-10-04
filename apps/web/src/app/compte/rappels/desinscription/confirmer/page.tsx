import type { Metadata } from 'next';
import { Suspense } from 'react';
import { fr } from '@/i18n/fr';
import { RappelsDesinscriptionConfirmer } from './rappels-desinscription-confirmer';

export const metadata: Metadata = {
  title: fr.compte.rappels.desinscription.page.title,
};

export default function RappelsDesinscriptionConfirmerPage() {
  return (
    <Suspense>
      <RappelsDesinscriptionConfirmer />
    </Suspense>
  );
}
