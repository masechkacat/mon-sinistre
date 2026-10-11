import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { SectionHeading } from '@/components/section-heading';

export function MessageScreen({
  title,
  description,
  children,
  inline = false,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  /** The message replaces a block inside a page that keeps its own title and
   * padding: a second `h1` and a second page container would both be wrong. */
  inline?: boolean;
}) {
  const corps = (
    <>
      {inline ? (
        <SectionHeading>{title}</SectionHeading>
      ) : (
        <PageTitle>{title}</PageTitle>
      )}
      <p className="text-lg text-muted-foreground">{description}</p>
      {children}
    </>
  );

  return inline ? (
    <section className="space-y-4">{corps}</section>
  ) : (
    <PageContainer className="space-y-4">{corps}</PageContainer>
  );
}
