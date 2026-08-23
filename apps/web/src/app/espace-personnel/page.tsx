import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { EspacePersonnel } from './espace-personnel';

export const metadata: Metadata = {
  title: fr.compte.espacePersonnel.page.title,
};

export default function EspacePersonnelPage() {
  return <EspacePersonnel />;
}
