import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { fr } from '@/i18n/fr';

export const metadata: Metadata = { title: fr.accessibilite.title };

export default function Accessibilite() {
  return (
    <LegalPage
      title={fr.accessibilite.title}
      sections={fr.accessibilite.sections}
    />
  );
}
