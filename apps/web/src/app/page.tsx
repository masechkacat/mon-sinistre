import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { fr } from '@/i18n/fr';

function SectionHeading({ children }: { children: string }) {
  return <h2 className="text-xl font-semibold">{children}</h2>;
}

export default function Home() {
  return (
    <div className="mx-auto max-w-2xl space-y-12 px-6 py-16">
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {fr.home.title}
        </h1>
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
    </div>
  );
}
