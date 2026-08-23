import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { ConnexionForm } from './connexion-form';

export const metadata: Metadata = { title: fr.compte.connexion.page.title };

export default function ConnexionPage() {
  return <ConnexionForm />;
}
