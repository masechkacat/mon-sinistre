import { PageTitle } from '@/components/page-title';

/** The head of a dossier screen: what it is about and where it stands. */
export function DossierEntete({
  title,
  statut,
}: {
  title: string;
  statut: string;
}) {
  return (
    <section className="space-y-1">
      <PageTitle>{title}</PageTitle>
      <p className="text-lg text-muted-foreground">{statut}</p>
    </section>
  );
}
