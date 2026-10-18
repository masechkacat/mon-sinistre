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

const copy = fr.communeAnswer;

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
export function CommuneAnswer({ commune }: { commune: Commune | null }) {
  if (!commune) {
    return (
      <section data-testid="commune-arretes">
        <p role="status" className="min-h-7 text-lg" />
      </section>
    );
  }
  return <ChosenCommuneAnswer commune={commune} />;
}

function ChosenCommuneAnswer({ commune }: { commune: Commune }) {
  const query = useQuery({
    queryKey: queryKeys.communeArretes(commune.codeInsee),
    queryFn: () => fetchCommuneArretes(commune.codeInsee),
  });
  const arretes = query.data?.arretes;

  return (
    <div className="space-y-8">
      <section data-testid="commune-arretes" className="space-y-4">
        <p role="status" className="min-h-7 text-lg">
          {announcement(commune, query)}
        </p>

        {query.isError ? <RequestError /> : null}

        {arretes?.length ? (
          <ul className="space-y-4">
            {arretes.map((arrete) => (
              <li
                key={arrete.arreteEntryId}
                data-testid={`arrete-${arrete.arreteEntryId}`}
              >
                <ArreteCard commune={commune} arrete={arrete} />
              </li>
            ))}
          </ul>
        ) : null}

        {arretes?.length === 0 ? (
          <div className="space-y-4">
            <p>{copy.noneSince(COMMUNE_ARRETES_WINDOW_MONTHS)}</p>
            <Link
              href={dossierPath('/dossier', { commune: commune.codeInsee })}
              className={buttonVariants({ size: 'touch' })}
            >
              {copy.prepare}
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

function announcement(
  commune: Commune,
  query: { isPending: boolean; data?: CommuneArretes },
) {
  if (query.isPending) return copy.loading;
  if (!query.data) return null;
  // One arrêté names the commune once per risk and period (`CommuneArrete`):
  // the visitor is told how many texts there are, not how many lines.
  const count = new Set(query.data.arretes.map((a) => a.nor)).size;
  return count ? copy.found(count, commune.name) : copy.none(commune.name);
}

function ArreteCard({
  commune,
  arrete,
}: {
  commune: Commune;
  arrete: CommuneArrete;
}) {
  const title = risquesTitle(arrete);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
        {title === arrete.risqueLabel ? null : (
          <CardDescription>{arrete.risqueLabel}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm">
          <p>
            {copy.period(
              formatDateFr(arrete.eventStart),
              formatDateFr(arrete.eventEnd),
            )}
          </p>
          <ArretePublication arrete={arrete} />
        </div>

        {arrete.outcome === ArreteEntryOutcome.REFUSE ? (
          <p>{copy.refusal}</p>
        ) : null}

        {arrete.declarationDeadline ? (
          <div className="space-y-2">
            <p className="font-medium">
              {fr.sinistres.detail.deadline.heading}
            </p>
            <DeclarationDeadlineValue
              deadline={arrete.declarationDeadline}
              preview
            />
          </div>
        ) : null}

        <Link
          href={dossierLink(commune, arrete)}
          aria-label={copy.openFor(title)}
          className={buttonVariants({ size: 'touch' })}
        >
          {copy.open}
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
function risquesTitle({ risqueLabel, risques }: CommuneArrete): string {
  return risques.length === 0
    ? risqueLabel
    : risques.map((r) => fr.sinistres.risque.options[r].label).join(', ');
}

/**
 * The date is the first day of the period: the visitor refines it on the
 * dossier page, within the period. The risk is told when the arrêté names one
 * and asked for otherwise (`parseRisqueOptions`).
 */
function dossierLink(commune: Commune, arrete: CommuneArrete) {
  const [risque, ...others] = arrete.risques;
  const single = risque !== undefined && others.length === 0;

  return dossierPath('/dossier', {
    commune: commune.codeInsee,
    risque: single ? risque : undefined,
    risques: single ? undefined : arrete.risques,
    date: arrete.eventStart,
  });
}
