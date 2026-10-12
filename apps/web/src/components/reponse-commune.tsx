'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ArreteEntryOutcome,
  COMMUNE_ARRETES_WINDOW_MONTHS,
  type Commune,
  type CommuneArrete,
  type CommuneArretes,
} from '@mon-sinistre/contracts';
import { ArretePublication } from '@/components/plan/arrete-publication';
import { DeclarationDeadlineValue } from '@/components/plan/declaration-deadline-block';
import { RequestError } from '@/components/request-error';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { VeilleInlineForm } from '@/components/veille-inline-form';
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
 *
 * `null` is the screen before a commune is chosen: the live region is mounted
 * from the first paint, so that it exists before it has an answer to announce.
 * Mounting it with the choice would leave the answer unread whenever it comes
 * from the cache — the second look at a commune already seen.
 */
export function ReponseCommune({ commune }: { commune: Commune | null }) {
  if (!commune) {
    return (
      <section data-testid="reponse-arretes">
        <p role="status" className="min-h-7 text-lg" />
      </section>
    );
  }
  return <ReponseCommuneChoisie commune={commune} />;
}

function ReponseCommuneChoisie({ commune }: { commune: Commune }) {
  const query = useQuery({
    queryKey: queryKeys.communeArretes(commune.codeInsee),
    queryFn: () => fetchCommuneArretes(commune.codeInsee),
  });
  const arretes = query.data?.arretes;

  return (
    <div className="space-y-8">
      <section data-testid="reponse-arretes" className="space-y-4">
        <p role="status" className="min-h-7 text-lg">
          {annonce(commune, query)}
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

      {/* Offered whatever the answer is, and before it arrives: an arrêté can
          appear weeks after the event. */}
      <VeilleInlineForm commune={commune} />
    </div>
  );
}

function annonce(
  commune: Commune,
  query: { isPending: boolean; data?: CommuneArretes },
) {
  if (query.isPending) return copy.chargement;
  if (!query.data) return null;
  // One arrêté names the commune once per risk and period (`CommuneArrete`):
  // the visitor is told how many texts there are, not how many lines.
  const nombre = new Set(query.data.arretes.map((a) => a.nor)).size;
  return nombre ? copy.trouves(nombre, commune.name) : copy.aucun(commune.name);
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
        <CardTitle as="h2">{titre}</CardTitle>
        {titre === arrete.risqueLabel ? null : (
          <CardDescription>{arrete.risqueLabel}</CardDescription>
        )}
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

/**
 * The categories the arrêté was classified to, with the wording of the Journal
 * officiel as the line under them — and as the title itself when the
 * classifier knows none of them yet.
 */
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
