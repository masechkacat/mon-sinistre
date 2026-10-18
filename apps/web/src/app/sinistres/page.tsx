import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { SinistresList } from './sinistres-list';

export const metadata: Metadata = { title: fr.sinistres.list.page.title };

export default function SinistresPage() {
  return <SinistresList />;
}
