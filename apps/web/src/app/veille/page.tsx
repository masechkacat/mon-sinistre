import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { VeilleForm } from './veille-form';

export const metadata: Metadata = { title: fr.veille.page.title };

export default function VeillePage() {
  return <VeilleForm />;
}
