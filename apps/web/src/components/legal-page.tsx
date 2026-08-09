import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { SectionHeading } from '@/components/section-heading';

export type LegalSection = { heading: string; paragraphs: readonly string[] };

export function LegalPage({
  title,
  sections,
}: {
  title: string;
  sections: readonly LegalSection[];
}) {
  return (
    <PageContainer className="space-y-12">
      <PageTitle>{title}</PageTitle>
      {sections.map((section) => (
        <section key={section.heading} className="space-y-4">
          <SectionHeading>{section.heading}</SectionHeading>
          {section.paragraphs.map((paragraph, index) => (
            // Index keys are deliberate: the list is static server-rendered
            // content, while legal boilerplate can repeat a sentence verbatim
            // — text-as-key would then collide.
            <p key={index}>{paragraph}</p>
          ))}
        </section>
      ))}
    </PageContainer>
  );
}
