import Link from 'next/link';
import { DeadlineBadge } from '@/components/deadline-badge';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fr } from '@/i18n/fr';
import { cn } from '@/lib/utils';
import { badgeCases } from './cases';

const forms = ['hero', 'row'] as const;

// A button and a link twice over: on the ground and on a sheet. The pair is
// what axe needs to measure the interactive colours of both surfaces, and
// this page is the one the shared suites walk in both themes.
function Controls() {
  return (
    <>
      <Button size="touch">{fr.serverError.retry}</Button>
      <Link href="/" className="text-primary underline underline-offset-4">
        {fr.notFound.backHome}
      </Link>
    </>
  );
}

/**
 * The material sample of the deadline badge: every state of both forms, which
 * is what the snapshot and contrast suites photograph (docs/research/design-system.md,
 * «Тесты: контраст, снимки, правила по исходникам»).
 */
export function TestBejdz() {
  return (
    <PageContainer className="space-y-8">
      <PageTitle>{fr.deadlineBadge.testPage}</PageTitle>

      {forms.map((form) => (
        <div key={form} className="flex flex-wrap items-start gap-6">
          {badgeCases.map((entry) => (
            <div
              key={entry.state}
              data-testid={`badge-${form}-${entry.state}`}
              // The padding is the second sheet's room: a box-shadow lies
              // outside the element, and a screenshot of the badge alone
              // would cut the sheet off.
              className={cn('pr-2 pb-2', form === 'hero' ? 'w-62' : 'w-full')}
            >
              <DeadlineBadge
                form={form}
                state={entry.state}
                date={entry.date}
                daysLeft={entry.daysLeft}
                completedAt={'completedAt' in entry ? entry.completedAt : null}
                delay={'delay' in entry ? entry.delay : null}
                anchor={'anchor' in entry ? entry.anchor : null}
              />
            </div>
          ))}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-4">
        <Controls />
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Controls />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
