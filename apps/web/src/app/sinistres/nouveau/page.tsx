import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { SinistreNouveauForm } from './sinistre-nouveau-form';

export const metadata: Metadata = { title: fr.sinistres.nouveau.page.title };

export default function SinistreNouveauPage() {
  return <SinistreNouveauForm />;
}
