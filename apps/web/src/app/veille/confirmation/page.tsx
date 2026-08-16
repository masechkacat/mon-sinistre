import type { Metadata } from 'next';
import { Suspense } from 'react';
import { fr } from '@/i18n/fr';
import { VeilleConfirmation } from './veille-confirmation';

export const metadata: Metadata = { title: fr.veille.confirmation.page.title };

export default function VeilleConfirmationPage() {
  return (
    <Suspense>
      <VeilleConfirmation />
    </Suspense>
  );
}
