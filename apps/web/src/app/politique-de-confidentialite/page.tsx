import type { Metadata } from 'next';
import { LegalPage, legalSections } from '@/components/legal-page';
import { fr } from '@/i18n/fr';

export const metadata: Metadata = { title: fr.politiqueConfidentialite.title };

export default function PolitiqueConfidentialite() {
  return (
    <LegalPage
      title={fr.politiqueConfidentialite.title}
      sections={legalSections(fr.politiqueConfidentialite)}
    />
  );
}
