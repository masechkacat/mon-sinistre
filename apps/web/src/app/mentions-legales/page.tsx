import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { fr } from '@/i18n/fr';

export const metadata: Metadata = { title: fr.mentionsLegales.title };

export default function MentionsLegales() {
  return (
    <LegalPage
      title={fr.mentionsLegales.title}
      sections={fr.mentionsLegales.sections}
    />
  );
}
