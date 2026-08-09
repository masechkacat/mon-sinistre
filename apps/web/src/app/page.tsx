import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { SectionHeading } from '@/components/section-heading';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { fr } from '@/i18n/fr';

export default function Home() {
  return (
    <PageContainer className="space-y-12">
      <section className="space-y-4">
        <PageTitle>{fr.home.title}</PageTitle>
        <p className="text-lg text-muted-foreground">{fr.home.lead}</p>
      </section>

      <section className="space-y-4">
        <SectionHeading>{fr.home.catnat.heading}</SectionHeading>
        <p>{fr.home.catnat.event}</p>
        <p>{fr.home.catnat.arrete}</p>
        <p>{fr.home.catnat.deadline}</p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <Card className="text-base">
          <CardHeader>
            <SectionHeading>{fr.home.does.heading}</SectionHeading>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-2 pl-5">
              {fr.home.does.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="text-base">
          <CardHeader>
            <SectionHeading>{fr.home.doesNot.heading}</SectionHeading>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-2 pl-5">
              {fr.home.doesNot.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeading>{fr.home.next.heading}</SectionHeading>
        <ol className="list-decimal space-y-2 pl-5">
          {fr.home.next.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
    </PageContainer>
  );
}
