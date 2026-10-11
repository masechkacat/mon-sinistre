'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ArreteEntryOutcome,
  COMMUNE_ARRETES_WINDOW_MONTHS,
  type Commune,
  type CommuneArrete,
} from '@mon-sinistre/contracts';
import { ArretePublication } from '@/components/plan/arrete-publication';
import { DeclarationDeadlineValue } from '@/components/plan/declaration-deadline-block';
import { RequestError } from '@/components/request-error';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { fetchCommuneArretes } from '@/lib/api/dossier';
import { queryKeys } from '@/lib/api/keys';
import { dossierPath } from '@/lib/dossier-params';

const copy = fr.reponseCommune;

/**
 * The answer about one commune: the arrêtés published for it in the window of
 * `COMMUNE_ARRETES_WINDOW_MONTHS`, each one a way into its own dossier. Takes
 * the commune instead of reading it from the page, so the map popup can ask
 * the same question later (docs/research/dossier-preliminaire.md).
 */
export function ReponseCommune({ commune }: { commune: Commune }) {
  const query = useQuery({
    queryKey: queryKeys.communeArretes(commune.codeInsee),
    queryFn: () => fetchCommuneArretes(commune.codeInsee),
  });
  const arretes = query.data?.arretes;

  return (
    <section className="space-y-4">
      <p role="status" className="min-h-7 text-lg">
        {query.isPending ? copy.chargement : null}
        {arretes?.length ? copy.trouves(arretes.length, commune.name) : null}
        {arretes?.length === 0 ? copy.aucun(commune.name) : null}
      </p>

      {query.isError ? <RequestError /> : null}

      {arretes?.length ? (
        <ul className="space-y-4">
          {arretes.map((arrete) => (
            <li
              key={arrete.arreteEntryId}
              data-testid={`arrete-${arrete.arreteEntryId}`}
            >
              <CarteArrete commune={commune} arrete={arrete} />
            </li>
          ))}
        </ul>
      ) : null}

      {arretes?.length === 0 ? (
        <div className="space-y-4">
          <p>{copy.aucunSuite(COMMUNE_ARRETES_WINDOW_MONTHS)}</p>
          <Link
            href={dossierPath('/dossier', { commune: commune.codeInsee })}
            className={buttonVariants({ size: 'touch' })}
          >
            {copy.preparer}
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function CarteArrete({
  commune,
  arrete,
}: {
  commune: Commune;
  arrete: CommuneArrete;
}) {
  const titre = risquesTitre(arrete);

  return (
    <Card>
      <CardHeader>
        {/* The wording of the Journal officiel, as a hint beside the
            categories it was classified to — and the title itself when the
            classifier knows none of them yet. */}
        <CardTitle as="h2" title={arrete.risqueLabel}>
          {titre}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm">
          <p>
            {copy.periode(
              formatDateFr(arrete.eventStart),
              formatDateFr(arrete.eventEnd),
            )}
          </p>
          <ArretePublication arrete={arrete} />
        </div>

        {arrete.outcome === ArreteEntryOutcome.REFUSE ? (
          <p>{copy.refus}</p>
        ) : null}

        {arrete.declarationDeadline ? (
          <div className="space-y-2">
            <p className="font-medium">
              {fr.sinistres.detail.deadline.heading}
            </p>
            <DeclarationDeadlineValue
              deadline={arrete.declarationDeadline}
              form="row"
              apercu
            />
          </div>
        ) : null}

        <Link
          href={dossierLien(commune, arrete)}
          aria-label={copy.ouvrirPour(titre)}
          className={buttonVariants({ size: 'touch' })}
        >
          {copy.ouvrir}
        </Link>
      </CardContent>
    </Card>
  );
}

function risquesTitre({ risqueLabel, risques }: CommuneArrete): string {
  return risques.length === 0
    ? risqueLabel
    : risques.map((r) => fr.sinistres.risque.options[r].label).join(', ');
}

/**
 * The date is the first day of the period: the visitor refines it on the
 * dossier page, within the period. The risk is told when the arrêté names one
 * and asked for otherwise (`parseRisqueOptions`).
 */
function dossierLien(commune: Commune, arrete: CommuneArrete) {
  const [risque, ...autres] = arrete.risques;
  const seul = risque !== undefined && autres.length === 0;

  return dossierPath('/dossier', {
    commune: commune.codeInsee,
    risque: seul ? risque : undefined,
    risques: seul ? undefined : arrete.risques,
    date: arrete.eventStart,
  });
}
