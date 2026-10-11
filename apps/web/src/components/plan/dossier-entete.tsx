import { PageTitle } from '@/components/page-title';

/**
 * The head of a dossier screen: what it is about, where it stands and — in
 * `children` — the key dates of the event behind it.
 */
export function DossierEntete({
  title,
  statut,
  children,
}: {
  title: string;
  statut: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      <PageTitle>{title}</PageTitle>
      <p className="text-lg text-muted-foreground">{statut}</p>
      {children}
    </section>
  );
}
