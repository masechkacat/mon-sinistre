import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { MotDePasseOublieForm } from './mot-de-passe-oublie-form';

export const metadata: Metadata = {
  title: fr.compte.motDePasseOublie.page.title,
};

export default function MotDePasseOubliePage() {
  return <MotDePasseOublieForm />;
}
