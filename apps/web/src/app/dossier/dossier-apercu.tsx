'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DossierApercu } from '@mon-sinistre/contracts';
import { PageContainer } from '@/components/page-container';
import { DeclarationDeadlineBlock } from '@/components/plan/declaration-deadline-block';
import { DossierEntete } from '@/components/plan/dossier-entete';
import { PlanList } from '@/components/plan/plan-list';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { fetchDossierApercu } from '@/lib/api/dossier';
import { queryKeys } from '@/lib/api/keys';
import {
  dossierSearch,
  parseDossierParams,
  type DossierParams,
} from '@/lib/dossier-params';
import { dossierTitle } from '@/lib/dossier-title';

export function DossierApercuView() {
  const searchParams = useSearchParams();
  const { commune, risque, date } = parseDossierParams(searchParams);

  // The aperçu needs all three parameters; what is missing is asked for on
  // this same page (docs/plan/dossier-preliminaire.md, фаза 5).
  return commune && risque && date ? (
    <Apercu params={{ commune, risque, date }} />
  ) : null;
}

function Apercu({ params }: { params: Required<DossierParams> }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.dossierApercu(
      params.commune,
      params.risque,
      params.date,
    ),
    queryFn: () => fetchDossierApercu(params),
  });
  const apercu = query.data;

  return (
    <PageContainer className="space-y-8">
      {/* The whole screen comes from the request, so until it answers there
          is nothing else on the page to read. */}
      <p role="status" className="min-h-7 text-lg text-muted-foreground">
        {query.isPending ? fr.dossier.chargement : null}
      </p>

      {query.isError ? <RequestError /> : null}

      {apercu ? (
        <>
          <DossierEntete
            title={dossierTitle(apercu)}
            statut={fr.sinistres.statut[apercu.status]}
          >
            <p>
              {fr.sinistres.liste.eventDate(formatDateFr(apercu.eventDate))}
            </p>
            {apercu.arrete ? <ArreteLignes arrete={apercu.arrete} /> : null}
          </DossierEntete>

          {apercu.declarationDeadline ? (
            <DeclarationDeadlineBlock
              deadline={apercu.declarationDeadline}
              apercu
            />
          ) : null}

          {/* No onMark: nothing is stored to be marked until the dossier is
              saved, so the plan is read-only here. */}
          <PlanList steps={apercu.steps} />

          <Button
            size="touch"
            onClick={() =>
              router.push(`/inscription${dossierSearch(params)}` as Route)
            }
          >
            {fr.dossier.enregistrer}
          </Button>
        </>
      ) : null}
    </PageContainer>
  );
}

function ArreteLignes({
  arrete,
}: {
  arrete: NonNullable<DossierApercu['arrete']>;
}) {
  return (
    <>
      <p>{fr.dossier.publieLe(formatDateFr(arrete.publishedAt))}</p>
      <p>
        <a href={arrete.legifranceUrl} className="underline underline-offset-4">
          {fr.dossier.legifranceLink}
        </a>
      </p>
    </>
  );
}
