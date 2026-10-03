'use client';

import { useQuery } from '@tanstack/react-query';
import {
  StepStatus,
  type DeclarationDeadline,
  type Step,
} from '@mon-sinistre/contracts';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { fetchSinistre } from '@/lib/api/sinistres';
import { queryKeys } from '@/lib/api/keys';
import { useSessionGuard } from '@/lib/api/use-session-guard';
import { dossierTitle } from '@/lib/dossier-title';
import { nextUpcomingStep } from '@/lib/sinistre-timeline';
import { SourceNote } from './source-note';

export function SinistreDetailView({ id }: { id: string }) {
  const status = useSessionGuard();
  const query = useQuery({
    queryKey: queryKeys.sinistre(id),
    queryFn: () => fetchSinistre(id),
    enabled: status === 'authenticated',
  });
  const sinistre = query.data;
  const next = sinistre ? nextUpcomingStep(sinistre.steps) : null;

  return (
    <PageContainer className="space-y-8">
      {status === 'checking' ? (
        <p
          data-testid="session-status"
          className="text-lg text-muted-foreground"
        >
          {fr.session.checking}
        </p>
      ) : null}

      {query.isError ? <RequestError /> : null}

      {sinistre ? (
        <>
          <section className="space-y-1">
            <PageTitle>{dossierTitle(sinistre)}</PageTitle>
            <p className="text-lg text-muted-foreground">
              {fr.sinistres.statut[sinistre.status]}
            </p>
          </section>

          {sinistre.declarationDeadline ? (
            <DeclarationDeadlineBlock deadline={sinistre.declarationDeadline} />
          ) : null}

          <ol
            aria-label={fr.sinistres.detail.timelineLabel}
            className="space-y-4"
          >
            {sinistre.steps.map((step) => (
              <StepItem
                key={step.id}
                step={step}
                isNext={step.id === next?.id}
              />
            ))}
          </ol>
        </>
      ) : null}
    </PageContainer>
  );
}

function DeclarationDeadlineBlock({
  deadline,
}: {
  deadline: DeclarationDeadline;
}) {
  const copy = fr.sinistres.detail.deadline;
  let remaining: string;
  if (deadline.daysLeft > 0) {
    remaining = copy.remaining(deadline.daysLeft);
  } else if (deadline.daysLeft === 0) {
    remaining = copy.today;
  } else {
    remaining = copy.overdue(-deadline.daysLeft);
  }

  return (
    <section className="space-y-1">
      <h2 className="text-xl font-semibold">{copy.heading}</h2>
      <p className="text-base">
        {copy.dateLimite(formatDateFr(deadline.date))}
      </p>
      <p className="text-lg font-medium">{remaining}</p>
      <SourceNote
        source={deadline.source}
        sujet={fr.sinistres.detail.deadline.heading}
      />
    </section>
  );
}

function StepItem({ step, isNext }: { step: Step; isNext: boolean }) {
  const copy = fr.sinistres.detail;
  const isClosed =
    step.status === StepStatus.FAIT ||
    step.status === StepStatus.NON_APPLICABLE;

  return (
    <li
      aria-current={isNext ? 'step' : undefined}
      className="space-y-1 rounded-lg border p-4"
    >
      <p className="text-lg font-medium">{step.name}</p>
      {isNext ? (
        <p className="text-sm font-semibold">{copy.prochaineEtape}</p>
      ) : null}
      <p className="text-base">{copy.stepStatus[step.status]}</p>
      {step.plannedDate ? (
        <p className="text-sm text-muted-foreground">
          {copy.datePrevue(formatDateFr(step.plannedDate))}
        </p>
      ) : null}
      {step.plannedDate && step.source && !isClosed ? (
        <SourceNote source={step.source} sujet={step.name} />
      ) : null}
      {!step.plannedDate && !isClosed ? (
        <p className="text-sm text-muted-foreground">
          {step.anchor ? copy.attentePar[step.anchor] : copy.sansDateNiAncre}
        </p>
      ) : null}
    </li>
  );
}
