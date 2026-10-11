import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { parseDossierParams } from '@/lib/dossier-params';
import { pageSearchParams } from '@/lib/page-search-params';
import { InscriptionForm } from './inscription-form';

export const metadata: Metadata = { title: fr.compte.inscription.page.title };

export default async function InscriptionPage({
  searchParams,
}: PageProps<'/inscription'>) {
  return (
    <InscriptionForm
      params={parseDossierParams(await pageSearchParams(searchParams))}
    />
  );
}
