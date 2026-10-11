'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import {
  ArreteEntryOutcome,
  isIsoDate,
  type Commune,
  type CreateSinistreInput,
  type DossierApercu,
  type RisqueCatnat,
} from '@mon-sinistre/contracts';
import { CommuneSelect } from '@/components/commune-select';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { DeclarationDeadlineBlock } from '@/components/plan/declaration-deadline-block';
import { DossierEntete } from '@/components/plan/dossier-entete';
import { DossierExistant } from '@/components/plan/dossier-existant';
import { PlanList } from '@/components/plan/plan-list';
import { RequestError } from '@/components/request-error';
import { SectionHeading } from '@/components/section-heading';
import {
  EventDateField,
  RisqueField,
  focusFirstFieldError,
  validateEventDate,
  type EventPeriode,
  type SinistreFieldErrors,
} from '@/components/sinistre-fields';
import { Button } from '@/components/ui/button';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { ApiError } from '@/lib/api/client';
import { fetchDossierApercu } from '@/lib/api/dossier';
import { queryKeys } from '@/lib/api/keys';
import { getAccessToken, refreshSession } from '@/lib/api/session';
import { useCreateSinistre } from '@/lib/api/use-create-sinistre';
import {
  dossierSearch,
  parseDossierParams,
  parseRisqueOptions,
  type DossierParams,
} from '@/lib/dossier-params';
import { dossierTitle } from '@/lib/dossier-title';
import { cn } from '@/lib/utils';

export function DossierApercuView() {
  const searchParams = useSearchParams();
  const params = parseDossierParams(searchParams);
  const risqueOptions = parseRisqueOptions(searchParams);

  // The aperçu needs all three parameters; what is missing is asked for on
  // this same page (docs/plan/dossier-preliminaire.md, фаза 5).
  return params.commune && params.risque && params.date ? (
    <Apercu
      params={{
        commune: params.commune,
        risque: params.risque,
        date: params.date,
      }}
      risqueOptions={risqueOptions}
    />
  ) : (
    <PageContainer className="space-y-8">
      <FormulaireEntete />
      <Formulaire params={params} risqueOptions={risqueOptions} />
    </PageContainer>
  );
}

/**
 * The failed save was sent for the dossier now on screen, so its answer still
 * belongs under the button. After the date is refined the address is another
 * dossier, and the banner would describe the previous one — the form of
 * `/sinistres/nouveau` drops it on the first edit for the same reason.
 */
function pourCeDossier(
  sent: CreateSinistreInput | undefined,
  params: Required<DossierParams>,
) {
  return (
    sent?.codeInsee === params.commune &&
    sent.risque === params.risque &&
    sent.eventDate === params.date
  );
}

function Apercu({
  params,
  risqueOptions,
}: {
  params: Required<DossierParams>;
  risqueOptions: readonly RisqueCatnat[];
}) {
  const router = useRouter();
  const { mutation, conflict, failed, confirmNew } = useCreateSinistre();
  const [enregistrement, setEnregistrement] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.dossierApercu(
      params.commune,
      params.risque,
      params.date,
    ),
    queryFn: () => fetchDossierApercu(params),
    // A refined date keeps the screen it was refined on: unmounting it while
    // the new aperçu loads would drop the focus to the top of the page.
    placeholderData: keepPreviousData,
  });
  const apercu = query.data;

  // A 400 is this endpoint's way of saying the address cannot be previewed —
  // an unknown commune, a future date — so the way out is the form, not the
  // "try again later" of a failed request.
  const refuse = query.error instanceof ApiError && query.error.status === 400;

  // Saving is the one step of the dossier that needs an account: the refresh
  // cookie is asked before the visitor is.
  const enregistrer = async () => {
    setEnregistrement(true);
    try {
      if (getAccessToken() || (await refreshSession())) {
        await mutation.mutateAsync({
          codeInsee: params.commune,
          risque: params.risque,
          eventDate: params.date,
        });
      } else {
        router.push(`/inscription${dossierSearch(params)}` as Route);
      }
    } catch {
      // Answered on screen by the hook: the conflict around this page, any
      // other failure under the button.
    } finally {
      setEnregistrement(false);
    }
  };

  return (
    <DossierExistant
      conflict={conflict}
      onConfirmNew={confirmNew}
      pending={mutation.isPending}
      failed={failed}
    >
      <PageContainer className="space-y-8">
        {/* The whole screen comes from the request, so until it answers there
          is nothing else on the page to read. Mounted before the answer and
          only ever changing text: the refusal below is announced that way
          (apps/web/CLAUDE.md, live-регионы). */}
        <p
          role="status"
          className={cn(
            'min-h-7 text-lg',
            refuse ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {query.isPending || query.isPlaceholderData
            ? fr.dossier.chargement
            : null}
          {refuse ? fr.dossier.formulaire.parametresRefuses : null}
        </p>

        {query.isError && !refuse ? <RequestError /> : null}

        {refuse ? (
          <>
            <FormulaireEntete />
            <Formulaire params={params} risqueOptions={risqueOptions} refuse />
          </>
        ) : null}

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

            {/* With a recognised arrêté the event date is no longer asked but
              refined: the visitor arrived from the commune answer with the
              first day of the period, and only the days it covers can anchor
              the plan (PRD, «Ouvrir mon dossier»). */}
            {apercu.arrete?.outcome === ArreteEntryOutcome.RECONNU ? (
              <section className="space-y-4">
                <SectionHeading>
                  {fr.dossier.formulaire.preciser.titre}
                </SectionHeading>
                <Formulaire
                  params={params}
                  risqueOptions={risqueOptions}
                  periode={{
                    min: apercu.arrete.eventStart,
                    max: apercu.arrete.eventEnd,
                  }}
                />
              </section>
            ) : null}

            {apercu.declarationDeadline ? (
              <DeclarationDeadlineBlock
                deadline={apercu.declarationDeadline}
                apercu
              />
            ) : null}

            {/* No onMark: nothing is stored to be marked until the dossier is
              saved, so the plan is read-only here. */}
            <PlanList steps={apercu.steps} apercu />

            <Button
              size="touch"
              onClick={() => enregistrer()}
              disabled={enregistrement}
            >
              {enregistrement
                ? fr.sinistres.nouveau.submitting
                : fr.dossier.enregistrer}
            </Button>

            {failed && pourCeDossier(mutation.variables, params) ? (
              <RequestError />
            ) : null}
          </>
        ) : null}
      </PageContainer>
    </DossierExistant>
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

function FormulaireEntete() {
  return (
    <section className="space-y-4">
      <PageTitle>{fr.dossier.formulaire.titre}</PageTitle>
      <p className="text-lg text-muted-foreground">
        {fr.dossier.formulaire.lead}
      </p>
    </section>
  );
}

function Formulaire({
  params,
  risqueOptions,
  refuse,
  periode,
}: {
  /** What the address already says: a parameter answered there is not asked. */
  params: DossierParams;
  risqueOptions: readonly RisqueCatnat[];
  /** The API refused this address: every field is asked again. */
  refuse?: boolean;
  /** Set on the aperçu screen: the date is then a refinement, not a question. */
  periode?: EventPeriode;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [commune, setCommune] = useState<Commune | null>(null);
  const [risque, setRisque] = useState<RisqueCatnat | null>(
    // A risque the address names but the options exclude is not preselected:
    // the radio would then look answered with a value the form rejects.
    params.risque && risqueOptions.includes(params.risque)
      ? params.risque
      : null,
  );
  const [eventDate, setEventDate] = useState<string>(params.date ?? '');
  const [errors, setErrors] = useState<SinistreFieldErrors>({});
  const [inchange, setInchange] = useState(false);
  const clearError = (champ: keyof SinistreFieldErrors) => {
    setInchange(false);
    setErrors((previous) => ({ ...previous, [champ]: undefined }));
  };

  // A refusal does not say which of the three it is about, so all three are
  // asked again — the commune included: only its code travelled in the
  // address, and the picker answers with a commune, not a code.
  const demande = {
    commune: refuse || !params.commune,
    risque: refuse || !params.risque,
    date: refuse || !params.date || Boolean(periode),
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: SinistreFieldErrors = {
      commune:
        demande.commune && !commune
          ? fr.sinistres.nouveau.communeRequiredError
          : undefined,
      risque:
        demande.risque && !risque
          ? fr.sinistres.risque.requiredError
          : undefined,
      eventDate: validateEventDate(eventDate, periode),
    };
    setErrors(next);
    if (
      next.commune ||
      next.risque ||
      next.eventDate ||
      !isIsoDate(eventDate)
    ) {
      focusFirstFieldError(formRef.current, next);
      return;
    }

    const reponse = {
      commune: commune?.codeInsee ?? params.commune,
      risque: risque ?? params.risque,
      date: eventDate,
    };
    // The same three values again: `replace` would navigate nowhere, and a
    // refusal would only be refused again.
    if (
      reponse.commune === params.commune &&
      reponse.risque === params.risque &&
      reponse.date === params.date
    ) {
      setInchange(true);
      return;
    }

    // Replace, not push: the incomplete address is a question already
    // answered, and the back button belongs to the page the visitor came
    // from. `risques`, the hint of a multi-risk arrêté, has done its job and
    // is left behind.
    router.replace(`/dossier${dossierSearch(reponse)}` as Route);
  };

  return (
    <form
      ref={formRef}
      className="space-y-6"
      onSubmit={handleSubmit}
      noValidate
    >
      {demande.commune ? (
        <CommuneSelect
          value={commune}
          onValueChange={(next) => {
            setCommune(next);
            if (next) clearError('commune');
          }}
          label={fr.sinistres.nouveau.communeLabel}
          error={errors.commune}
        />
      ) : null}

      {demande.risque ? (
        <RisqueField
          value={risque}
          onValueChange={(next) => {
            setRisque(next);
            clearError('risque');
          }}
          options={risqueOptions}
          error={errors.risque}
        />
      ) : null}

      {demande.date ? (
        <EventDateField
          value={eventDate}
          onValueChange={(next) => {
            setEventDate(next);
            clearError('eventDate');
          }}
          periode={periode}
          error={errors.eventDate}
        />
      ) : null}

      <Button
        type="submit"
        size="touch"
        variant={periode ? 'outline' : 'default'}
      >
        {periode
          ? fr.dossier.formulaire.preciser.submit
          : fr.dossier.formulaire.submit}
      </Button>
      <p role="status" className="text-lg text-destructive">
        {inchange && refuse ? fr.dossier.formulaire.inchange.refuse : null}
        {inchange && !refuse ? fr.dossier.formulaire.inchange.preciser : null}
      </p>
    </form>
  );
}
