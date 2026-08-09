import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { SectionHeading } from '@/components/section-heading';

type LegalSection = { heading: string; paragraphs: readonly string[] };

// The single definition of «a legal dictionary is a title plus sections»,
// shared by the pages and the content test — a section added to fr.ts
// appears on the page without touching either.
export function legalSections(
  dict: Record<string, string | LegalSection>,
): LegalSection[] {
  return Object.values(dict).filter(
    (value): value is LegalSection => typeof value !== 'string',
  );
}

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
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
    </PageContainer>
  );
}
