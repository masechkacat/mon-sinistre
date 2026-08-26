'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { Route } from 'next';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { fetchSinistres } from '@/lib/api/sinistres';
import { queryKeys } from '@/lib/api/keys';
import { useSessionGuard } from '@/lib/api/use-session-guard';

export function SinistresListe() {
  const status = useSessionGuard();
  const query = useQuery({
    queryKey: queryKeys.sinistres(),
    queryFn: fetchSinistres,
    enabled: status === 'authenticated',
  });

  return (
    <PageContainer className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <PageTitle>{fr.sinistres.liste.page.title}</PageTitle>
          <p className="text-lg text-muted-foreground">
            {fr.sinistres.liste.lead}
          </p>
        </div>
        <Link href="/sinistres/nouveau" className={buttonVariants()}>
          {fr.sinistres.liste.newSinistre}
        </Link>
      </section>

      {status === 'checking' ? (
        <p
          data-testid="session-status"
          className="text-lg text-muted-foreground"
        >
          {fr.session.checking}
        </p>
      ) : (
        <>
          {query.isError ? <RequestError /> : null}

          {query.data && query.data.length === 0 ? (
            <p
              data-testid="sinistres-empty"
              className="text-lg text-muted-foreground"
            >
              {fr.sinistres.liste.empty.description}
            </p>
          ) : null}

          {query.data && query.data.length > 0 ? (
            <ul className="space-y-4">
              {query.data.map((sinistre) => (
                <li
                  key={sinistre.id}
                  data-testid={`sinistre-card-${sinistre.id}`}
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {fr.sinistres.risque.options[sinistre.risque].label}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {fr.sinistres.liste.communeCode(sinistre.communeCode)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {fr.sinistres.liste.eventDate(
                          formatDateFr(sinistre.eventDate),
                        )}
                      </p>
                      <p className="text-sm font-medium">
                        {fr.sinistres.statut[sinistre.status]}
                      </p>
                      <Link
                        href={`/sinistres/${sinistre.id}` as Route}
                        className={buttonVariants({
                          variant: 'outline',
                          size: 'sm',
                        })}
                      >
                        {fr.sinistres.liste.viewLink}
                      </Link>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}
