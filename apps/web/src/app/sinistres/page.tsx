import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { SinistresListe } from './sinistres-liste';

export const metadata: Metadata = { title: fr.sinistres.liste.page.title };

export default function SinistresPage() {
  return <SinistresListe />;
}
