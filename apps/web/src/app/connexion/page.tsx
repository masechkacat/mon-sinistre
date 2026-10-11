import type { Metadata } from 'next';
import { fr } from '@/i18n/fr';
import { loginNextPath } from '@/lib/api/session';
import { parseDossierParams } from '@/lib/dossier-params';
import { pageSearchParams } from '@/lib/page-search-params';
import { ConnexionForm } from './connexion-form';

export const metadata: Metadata = { title: fr.compte.connexion.page.title };

export default async function ConnexionPage({
  searchParams,
}: PageProps<'/connexion'>) {
  const search = await pageSearchParams(searchParams);
  return (
    <ConnexionForm
      params={parseDossierParams(search)}
      suivant={loginNextPath(search)}
    />
  );
}
