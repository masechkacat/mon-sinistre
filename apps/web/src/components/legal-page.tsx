import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { SectionHeading } from '@/components/section-heading';

export type LegalSection = {
  heading: string;
  paragraphs: readonly string[];
  // A URL object, not a string: the dictionary walkers of the tests collect
  // its string leaves as visible text, and an address is never on screen.
  links?: readonly { text: string; href: URL }[];
};

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
          {/* Index keys are deliberate: the lists are static server-rendered
              content, while legal boilerplate can repeat a sentence or an
              address verbatim — text-as-key would then collide. */}
          {section.paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
          {section.links?.map((link, index) => (
            <p key={index}>
              <a href={link.href.href} className="underline underline-offset-4">
                {link.text}
              </a>
            </p>
          ))}
        </section>
      ))}
    </PageContainer>
  );
}
