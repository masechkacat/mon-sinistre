'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  StepStatus,
  type DeclarationDeadline,
  type Step,
} from '@mon-sinistre/contracts';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import {
  fetchSinistre,
  setSinistreStepStatus,
  type StepMark,
} from '@/lib/api/sinistres';
import { queryKeys } from '@/lib/api/keys';
import { useSessionGuard } from '@/lib/api/use-session-guard';
import { dossierTitle } from '@/lib/dossier-title';
import { nextUpcomingStep } from '@/lib/sinistre-timeline';
import { SourceNote } from './source-note';

interface StepMarkRequest {
  stepId: string;
  etape: string;
  status: StepMark;
}

export function SinistreDetailView({ id }: { id: string }) {
  const status = useSessionGuard();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.sinistre(id),
    queryFn: () => fetchSinistre(id),
    enabled: status === 'authenticated',
  });
  // Written by the mutation callbacks, not read off the latest `mutate` call:
  // a failure of one mark must not be overwritten by a later mark's result.
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const stepItems = useRef(new Map<string, HTMLLIElement>());
  const markMutation = useMutation({
    mutationFn: ({ stepId, status: mark }: StepMarkRequest) =>
      setSinistreStepStatus(id, stepId, mark),
    onSuccess: (_step, mark) => {
      setAnnouncement(markAnnouncement(mark));
      // The step's `li` stays mounted across the refetch, so focus survives
      // it; the buttons that held focus are replaced by the refetch.
      stepItems.current.get(mark.stepId)?.focus();
      return queryClient.invalidateQueries({
        queryKey: queryKeys.sinistre(id),
      });
    },
    onError: () => setAnnouncement(fr.sinistres.detail.marquageEchec),
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

      <p role="status" className="min-h-7 text-lg font-medium">
        {announcement}
      </p>

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
                itemRef={(node) => {
                  if (node) stepItems.current.set(step.id, node);
                  else stepItems.current.delete(step.id);
                }}
                onMark={(mark) =>
                  markMutation.mutate({
                    stepId: step.id,
                    etape: step.name,
                    status: mark,
                  })
                }
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

function markAnnouncement({ etape, status }: StepMarkRequest) {
  const copy = fr.sinistres.detail.annonce;
  if (status === StepStatus.FAIT) return copy.fait(etape);
  if (status === StepStatus.NON_APPLICABLE) return copy.nonApplicable(etape);
  return copy.annule(etape);
}

function StepItem({
  step,
  isNext,
  itemRef,
  onMark,
}: {
  step: Step;
  isNext: boolean;
  itemRef: (node: HTMLLIElement | null) => void;
  onMark: (mark: StepMark) => void;
}) {
  const copy = fr.sinistres.detail;
  const isClosed =
    step.status === StepStatus.FAIT ||
    step.status === StepStatus.NON_APPLICABLE;
  // Names the step inside each button, so a reader listing the buttons can
  // tell the steps apart — the three labels repeat across the timeline.
  const sujet = (
    <span className="sr-only">{copy.marquer.sujet(step.name)}</span>
  );

  return (
    <li
      ref={itemRef}
      tabIndex={-1}
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
      <div className="flex flex-wrap gap-2 pt-2">
        {isClosed ? (
          <Button variant="outline" size="touch" onClick={() => onMark(null)}>
            {copy.marquer.annuler}
            {sujet}
          </Button>
        ) : (
          <>
            <Button size="touch" onClick={() => onMark(StepStatus.FAIT)}>
              {copy.marquer.fait}
              {sujet}
            </Button>
            <Button
              variant="outline"
              size="touch"
              onClick={() => onMark(StepStatus.NON_APPLICABLE)}
            >
              {copy.marquer.nonApplicable}
              {sujet}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
