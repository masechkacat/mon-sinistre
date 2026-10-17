'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import {
  ArreteEntryOutcome,
  isIsoDate,
  type Commune,
  type RisqueCatnat,
} from '@mon-sinistre/contracts';
import { CommuneSelect } from '@/components/commune-select';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { ArretePublication } from '@/components/plan/arrete-publication';
import { DeclarationDeadlineBlock } from '@/components/plan/declaration-deadline-block';
import { DossierEntete } from '@/components/plan/dossier-entete';
import { DossierExistant } from '@/components/plan/dossier-existant';
import { DossierFeuille } from '@/components/plan/dossier-feuille';
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
import { fr } from '@/i18n/fr';
import { ApiError } from '@/lib/api/client';
import { fetchDossierApercu } from '@/lib/api/dossier';
import { queryKeys } from '@/lib/api/keys';
import { getAccessToken, refreshSession } from '@/lib/api/session';
import { useCreateSinistre } from '@/lib/api/use-create-sinistre';
import { chronologiePoints } from '@/lib/dossier-chronologie';
import {
  dossierInput,
  dossierPath,
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

function Apercu({
  params,
  risqueOptions,
}: {
  params: Required<DossierParams>;
  risqueOptions: readonly RisqueCatnat[];
}) {
  const router = useRouter();
  const { mutation, conflict, failed, confirmNew, dismissConflict } =
    useCreateSinistre(dossierInput(params));
  const [enregistrement, setEnregistrement] = useState(false);
  // Keyed on the address like the hook's own answers: `Apercu` outlives a
  // change of it (`keepPreviousData`), and a failure must not outlive the
  // dossier it was about.
  const [sessionEchecPour, setSessionEchecPour] = useState<string>();
  const sessionEchec = sessionEchecPour === dossierSearch(params);
  const ecranRef = useRef<HTMLDivElement>(null);
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

  const enregistrer = async () => {
    setEnregistrement(true);
    setSessionEchecPour(undefined);
    try {
      const session = getAccessToken() ? 'open' : await refreshSession();
      if (session === 'open') {
        await mutation.mutateAsync(dossierInput(params));
      } else if (session === 'none') {
        router.push(dossierPath('/inscription', params));
      } else {
        setSessionEchecPour(dossierSearch(params));
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
      onCorriger={() => {
        dismissConflict();
        ecranRef.current
          ?.querySelector<HTMLElement>('input[type="date"], [data-enregistrer]')
          ?.focus();
      }}
      pending={mutation.isPending}
      failed={failed}
    >
      <PageContainer ref={ecranRef} className="space-y-8">
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
              status={apercu.status}
              points={chronologiePoints(apercu)}
              badge={
                apercu.declarationDeadline ? (
                  <DeclarationDeadlineBlock
                    deadline={apercu.declarationDeadline}
                    apercu
                  />
                ) : null
              }
            >
              {apercu.arrete ? (
                <ArretePublication arrete={apercu.arrete} />
              ) : null}
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

            {/* No onMark: nothing is stored to be marked until the dossier is
              saved, so the plan is read-only here. */}
            <DossierFeuille>
              <PlanList steps={apercu.steps} />
            </DossierFeuille>

            <Button
              size="touch"
              onClick={() => enregistrer()}
              disabled={enregistrement}
              data-enregistrer
            >
              {enregistrement
                ? fr.dossier.enregistrement
                : fr.dossier.enregistrer}
            </Button>

            {failed || sessionEchec ? <RequestError /> : null}
          </>
        ) : null}
      </PageContainer>
    </DossierExistant>
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
    router.replace(dossierPath('/dossier', reponse));
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
