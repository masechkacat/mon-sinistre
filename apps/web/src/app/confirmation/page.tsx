import type { Metadata } from 'next';
import { Suspense } from 'react';
import { fr } from '@/i18n/fr';
import { CompteConfirmation } from './compte-confirmation';

export const metadata: Metadata = { title: fr.compte.confirmation.page.title };

export default function ConfirmationPage() {
  return (
    <Suspense>
      <CompteConfirmation />
    </Suspense>
  );
}
