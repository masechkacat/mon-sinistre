import { PageTitle } from '@/components/page-title';

export function MessageScreen({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-16">
      <PageTitle>{title}</PageTitle>
      <p className="text-lg text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}
