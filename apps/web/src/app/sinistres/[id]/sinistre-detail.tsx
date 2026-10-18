'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { StepKind, StepStatus } from '@mon-sinistre/contracts';
import { PageContainer } from '@/components/page-container';
import { DeclarationDeadlineBlock } from '@/components/plan/declaration-deadline-block';
import { DeclarationStrip } from '@/components/plan/declaration-strip';
import { DossierHeader } from '@/components/plan/dossier-header';
import { DossierSheet } from '@/components/plan/dossier-sheet';
import { PlanList } from '@/components/plan/plan-list';
import { RequestError } from '@/components/request-error';
import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { fr } from '@/i18n/fr';
import {
  deleteSinistre,
  fetchSinistre,
  setSinistreStepStatus,
  type StepMark,
} from '@/lib/api/sinistres';
import { queryKeys } from '@/lib/api/keys';
import { useSessionGuard } from '@/lib/api/use-session-guard';
import { timelinePoints } from '@/lib/dossier-timeline';
import { dossierTitle } from '@/lib/dossier-title';

interface StepMarkRequest {
  stepId: string;
  stepName: string;
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
  // The step a successful mark — or the déclaration date, which marks its
  // step — gives the focus back to. A marked step trades the plan for the row
  // of what is behind — and comes back when the mark is undone — so the node
  // that held the focus is gone by then: the focus can only follow once the
  // answer is rendered, hence the effect below.
  const focusAfterMark = useRef<string | null>(null);
  const markMutation = useMutation({
    mutationFn: ({ stepId, status: mark }: StepMarkRequest) =>
      setSinistreStepStatus(id, stepId, mark),
    onSuccess: async (_step, mark) => {
      setAnnouncement(markAnnouncement(mark));
      focusAfterMark.current = mark.stepId;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sinistre(id),
      });
      // A refetch that failed renders nothing new, so the effect below has
      // not consumed the target: left in place, it would move the focus on
      // the next unrelated update of the dossier.
      if (
        queryClient.getQueryState(queryKeys.sinistre(id))?.status === 'error'
      ) {
        focusAfterMark.current = null;
      }
    },
    onError: () => setAnnouncement(fr.sinistres.detail.markFailure),
  });
  const sinistre = query.data;

  useEffect(() => {
    const stepId = focusAfterMark.current;
    const node = stepId === null ? null : stepItems.current.get(stepId);
    if (!node) return;
    focusAfterMark.current = null;
    node.focus();
  }, [sinistre]);

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
          <DossierHeader
            title={dossierTitle(sinistre)}
            status={sinistre.status}
            points={timelinePoints(sinistre)}
            badge={
              sinistre.declarationDeadline ? (
                <DeclarationDeadlineBlock
                  deadline={sinistre.declarationDeadline}
                />
              ) : null
            }
          />

          <DossierSheet>
            <PlanList
              steps={sinistre.steps}
              declaration={
                <DeclarationStrip
                  sinistreId={id}
                  declarationDate={sinistre.declarationDate}
                  onAnnounce={setAnnouncement}
                  onApplied={() => {
                    focusAfterMark.current =
                      sinistre.steps.find(
                        (step) => step.kind === StepKind.DECLARATION,
                      )?.id ?? null;
                  }}
                />
              }
              itemRef={(step, node) => {
                if (node) stepItems.current.set(step.id, node);
                else stepItems.current.delete(step.id);
              }}
              onMark={(step, mark) =>
                markMutation.mutate({
                  stepId: step.id,
                  stepName: step.name,
                  status: mark,
                })
              }
            />
          </DossierSheet>

          <SuppressionSection sinistreId={id} />
        </>
      ) : null}
    </PageContainer>
  );
}

function SuppressionSection({ sinistreId }: { sinistreId: string }) {
  const copy = fr.sinistres.detail.deletion;
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteSinistre(sinistreId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sinistres(),
        exact: true,
      });
      router.replace('/sinistres');
    },
  });

  return (
    <section className="border-t pt-8">
      <AlertDialog.Root>
        <AlertDialog.Trigger render={<Button variant="outline" size="touch" />}>
          {copy.open}
        </AlertDialog.Trigger>
        <AlertDialogContent>
          <AlertDialog.Title className="text-xl font-semibold">
            {copy.title}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-base">
            {copy.text}
          </AlertDialog.Description>
          <p role="alert" className="min-h-5 text-sm text-destructive">
            {mutation.isError ? copy.failure : null}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialog.Close
              render={<Button variant="outline" size="touch" />}
            >
              {copy.cancel}
            </AlertDialog.Close>
            <Button
              variant="outline"
              size="touch"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {copy.confirm}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog.Root>
    </section>
  );
}

function markAnnouncement({ stepName, status }: StepMarkRequest) {
  const copy = fr.sinistres.detail.announcement;
  if (status === StepStatus.FAIT) return copy.fait(stepName);
  if (status === StepStatus.NON_APPLICABLE) return copy.nonApplicable(stepName);
  return copy.undone(stepName);
}
