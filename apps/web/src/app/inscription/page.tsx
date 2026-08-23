import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { InscriptionForm } from './inscription-form';

export const metadata: Metadata = { title: fr.compte.inscription.page.title };

export default function InscriptionPage() {
  return <InscriptionForm />;
}
