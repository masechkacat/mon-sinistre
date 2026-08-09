import { PageContainer } from '@/components/page-container';
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
    <PageContainer className="space-y-4">
      <PageTitle>{title}</PageTitle>
      <p className="text-lg text-muted-foreground">{description}</p>
      {children}
    </PageContainer>
  );
}
