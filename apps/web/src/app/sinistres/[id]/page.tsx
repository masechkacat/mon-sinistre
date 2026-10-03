import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { SinistreDetailView } from './sinistre-detail';

export const metadata: Metadata = { title: fr.sinistres.detail.page.title };

export default async function SinistreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SinistreDetailView id={id} />;
}
