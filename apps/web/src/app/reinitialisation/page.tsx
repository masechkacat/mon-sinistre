import type { Metadata } from 'next';
import { Suspense } from 'react';
import { fr } from '@/i18n/fr';
import { ReinitialisationForm } from './reinitialisation-form';

export const metadata: Metadata = {
  title: fr.compte.reinitialisation.page.title,
};

export default function ReinitialisationPage() {
  return (
    <Suspense>
      <ReinitialisationForm />
    </Suspense>
  );
}
