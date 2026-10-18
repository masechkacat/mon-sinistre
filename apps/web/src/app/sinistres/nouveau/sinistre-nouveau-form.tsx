'use client';

import { useRef, useState, type FormEvent } from 'react';
import {
  isIsoDate,
  type Commune,
  type RisqueCatnat,
} from '@mon-sinistre/contracts';
import { CommuneSelect } from '@/components/commune-select';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { ExistingDossier } from '@/components/plan/existing-dossier';
import { RequestError } from '@/components/request-error';
import {
  EventDateField,
  RisqueField,
  focusFirstFieldError,
  validateEventDate,
} from '@/components/sinistre-fields';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { useCreateSinistre } from '@/lib/api/use-create-sinistre';
import { useSessionGuard } from '@/lib/api/use-session-guard';
import { fr } from '@/i18n/fr';

export function SinistreNouveauForm() {
  const status = useSessionGuard();
  const [commune, setCommune] = useState<Commune | null>(null);
  const [risque, setRisque] = useState<RisqueCatnat | null>(null);
  const [eventDate, setEventDate] = useState('');
  const [communeError, setCommuneError] = useState<string>();
  const [risqueError, setRisqueError] = useState<string>();
  const [eventDateError, setEventDateError] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);

  const { mutation, conflict, failed, confirmNew, dismissConflict } =
    useCreateSinistre();

  // The date's own future-date rule lives once, in the API's DTO validator
  // (IsNotFutureIsoDate) — this reads its French answer back rather than
  // re-checking the rule here (root CLAUDE.md, «не дублировать»). Gated on
  // `detailIsFieldError`: the only DTO validator this form can still trip is
  // the date's (commune and risque are already guaranteed valid by the
  // pickers above), but `SinistresService.create` can also 400 with an
  // unrelated business error (e.g. the selected commune stopped being
  // current between search and submit) — that one must not be mislabelled
  // as the date's.
  const apiEventDateError =
    mutation.error instanceof ApiError &&
    mutation.error.status === 400 &&
    mutation.error.detailIsFieldError
      ? mutation.error.detail
      : undefined;
  const eventDateFieldError = eventDateError ?? apiEventDateError;
  const requestFailed = failed && !apiEventDateError;

  // A failed request describes the form as it was sent, so the first edit to
  // any field makes that answer stale — the banner cannot outlive the state
  // it was about, whichever field the person goes back to.
  const dismissRequestError = () => {
    if (mutation.isError) mutation.reset();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextCommuneError = commune
      ? undefined
      : fr.sinistres.nouveau.communeRequiredError;
    const nextRisqueError = risque
      ? undefined
      : fr.sinistres.risque.requiredError;
    const nextEventDateError = validateEventDate(eventDate);

    setCommuneError(nextCommuneError);
    setRisqueError(nextRisqueError);
    setEventDateError(nextEventDateError);
    if (!commune || !risque || !isIsoDate(eventDate)) {
      focusFirstFieldError(formRef.current, {
        commune: nextCommuneError,
        risque: nextRisqueError,
        eventDate: nextEventDateError,
      });
      return;
    }

    mutation.mutate({
      codeInsee: commune.codeInsee,
      risque,
      eventDate,
    });
  };

  if (status === 'checking') {
    return (
      <PageContainer className="space-y-8">
        <PageTitle>{fr.sinistres.nouveau.page.title}</PageTitle>
        <p
          data-testid="session-status"
          className="text-lg text-muted-foreground"
        >
          {fr.session.checking}
        </p>
      </PageContainer>
    );
  }

  return (
    <ExistingDossier
      conflict={conflict}
      onConfirmNew={confirmNew}
      onEdit={() => {
        dismissConflict();
        focusFirstFieldError(formRef.current, {});
      }}
      pending={mutation.isPending}
      // Any failure, the date's own included: the field it would be tied to
      // is behind this screen.
      failed={failed}
    >
      <PageContainer className="space-y-8">
        <section className="space-y-4">
          <PageTitle>{fr.sinistres.nouveau.page.title}</PageTitle>
          <p className="text-lg text-muted-foreground">
            {fr.sinistres.nouveau.lead}
          </p>
        </section>

        <form
          ref={formRef}
          className="space-y-6"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={mutation.isPending}
        >
          <CommuneSelect
            value={commune}
            onValueChange={(next) => {
              setCommune(next);
              if (next) setCommuneError(undefined);
              dismissRequestError();
            }}
            label={fr.sinistres.nouveau.communeLabel}
            error={communeError}
          />

          <RisqueField
            value={risque}
            onValueChange={(next) => {
              setRisque(next);
              setRisqueError(undefined);
              dismissRequestError();
            }}
            error={risqueError}
          />

          <EventDateField
            value={eventDate}
            onValueChange={(next) => {
              setEventDate(next);
              setEventDateError(undefined);
              dismissRequestError();
            }}
            error={eventDateFieldError}
          />

          <Button type="submit" size="touch" disabled={mutation.isPending}>
            {mutation.isPending
              ? fr.sinistres.nouveau.submitting
              : fr.sinistres.nouveau.submit}
          </Button>

          {requestFailed ? <RequestError /> : null}
        </form>
      </PageContainer>
    </ExistingDossier>
  );
}
