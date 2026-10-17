'use client';

import { Field } from '@base-ui/react/field';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { StepStatus, isIsoDate, type IsoDate } from '@mon-sinistre/contracts';
import { FieldError } from '@/components/field-error';
import { PageContainer } from '@/components/page-container';
import { DeclarationDeadlineBlock } from '@/components/plan/declaration-deadline-block';
import { DossierEntete } from '@/components/plan/dossier-entete';
import { DossierFeuille } from '@/components/plan/dossier-feuille';
import { PlanList } from '@/components/plan/plan-list';
import { RequestError } from '@/components/request-error';
import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  inputControlClassName,
  inputFrameClassName,
  inputFrameInvalidClassName,
} from '@/components/ui/input';
import { fr } from '@/i18n/fr';
import { ApiError } from '@/lib/api/client';
import {
  deleteSinistre,
  fetchSinistre,
  setSinistreDeclarationDate,
  setSinistreStepStatus,
  type StepMark,
} from '@/lib/api/sinistres';
import { queryKeys } from '@/lib/api/keys';
import { useSessionGuard } from '@/lib/api/use-session-guard';
import { cn } from '@/lib/utils';
import { chronologiePoints } from '@/lib/dossier-chronologie';
import { dossierTitle } from '@/lib/dossier-title';

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
  // The step a successful mark gives the focus back to. A marked step trades
  // the plan for the row of what is behind — and comes back when the mark is
  // undone — so the node that held the focus is gone by then: the focus can
  // only follow once the answer is rendered, hence the effect below.
  const focusAfterMark = useRef<string | null>(null);
  const markMutation = useMutation({
    mutationFn: ({ stepId, status: mark }: StepMarkRequest) =>
      setSinistreStepStatus(id, stepId, mark),
    onSuccess: (_step, mark) => {
      setAnnouncement(markAnnouncement(mark));
      focusAfterMark.current = mark.stepId;
      return queryClient.invalidateQueries({
        queryKey: queryKeys.sinistre(id),
      });
    },
    onError: () => setAnnouncement(fr.sinistres.detail.marquageEchec),
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
          <DossierEntete
            title={dossierTitle(sinistre)}
            status={sinistre.status}
            points={chronologiePoints(sinistre)}
            badge={
              sinistre.declarationDeadline ? (
                <DeclarationDeadlineBlock
                  deadline={sinistre.declarationDeadline}
                />
              ) : null
            }
          />

          <DeclarationSection
            sinistreId={id}
            declarationDate={sinistre.declarationDate}
            onAnnounce={setAnnouncement}
          />

          <DossierFeuille>
            <PlanList
              steps={sinistre.steps}
              itemRef={(step, node) => {
                if (node) stepItems.current.set(step.id, node);
                else stepItems.current.delete(step.id);
              }}
              onMark={(step, mark) =>
                markMutation.mutate({
                  stepId: step.id,
                  etape: step.name,
                  status: mark,
                })
              }
            />
          </DossierFeuille>

          <SuppressionSection sinistreId={id} />
        </>
      ) : null}
    </PageContainer>
  );
}

function DeclarationSection({
  sinistreId,
  declarationDate,
  onAnnounce,
}: {
  sinistreId: string;
  declarationDate: IsoDate | null;
  onAnnounce: (message: string) => void;
}) {
  const copy = fr.sinistres.detail.declaration;
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(declarationDate ?? '');
  const [draftError, setDraftError] = useState<string>();
  // The field follows the server value: a date set or cleared elsewhere
  // arrives with the next refetch and must replace what was typed here.
  const [syncedDate, setSyncedDate] = useState(declarationDate);
  if (syncedDate !== declarationDate) {
    setSyncedDate(declarationDate);
    setDraft(declarationDate ?? '');
  }
  const mutation = useMutation({
    mutationFn: (next: IsoDate | null) =>
      setSinistreDeclarationDate(sinistreId, next),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.sinistre(sinistreId), detail);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sinistres(),
        exact: true,
      });
      onAnnounce(detail.declarationDate ? copy.enregistree : copy.effacee);
      if (!detail.declarationDate) inputRef.current?.focus();
    },
    onError: (_error, next) => {
      if (next === null) onAnnounce(copy.effacementEchec);
    },
  });

  // A failed save belongs to the field; a failed clear is announced above,
  // since the typed value is not what went wrong.
  const saveFailed = mutation.isError && mutation.variables !== null;
  // The API's own French sentence for a rejected date, shown as is.
  const apiError =
    mutation.error instanceof ApiError && mutation.error.status === 400
      ? mutation.error.detail
      : undefined;
  const error =
    draftError ?? (saveFailed ? (apiError ?? copy.echec) : undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isIsoDate(draft)) {
      setDraftError(copy.requis);
      return;
    }
    setDraftError(undefined);
    mutation.mutate(draft);
  };

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{copy.heading}</h2>
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Field.Root invalid={Boolean(error)} className="space-y-1.5">
          <Field.Label className="block text-sm font-medium">
            {copy.label}
          </Field.Label>
          <Field.Description className="block text-sm text-muted-foreground">
            {copy.hint}
          </Field.Description>
          <Field.Control
            ref={inputRef}
            type="date"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftError(undefined);
              if (mutation.isError) mutation.reset();
            }}
            className={cn(
              inputFrameClassName,
              inputControlClassName,
              error && inputFrameInvalidClassName,
            )}
          />
          <FieldError error={error} />
        </Field.Root>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="touch" disabled={mutation.isPending}>
            {copy.enregistrer}
          </Button>
          {declarationDate ? (
            <Button
              type="button"
              variant="outline"
              size="touch"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(null)}
            >
              {copy.effacer}
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function SuppressionSection({ sinistreId }: { sinistreId: string }) {
  const copy = fr.sinistres.detail.suppression;
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
          {copy.ouvrir}
        </AlertDialog.Trigger>
        <AlertDialogContent>
          <AlertDialog.Title className="text-xl font-semibold">
            {copy.titre}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-base">
            {copy.texte}
          </AlertDialog.Description>
          <p role="alert" className="min-h-5 text-sm text-destructive">
            {mutation.isError ? copy.echec : null}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialog.Close
              render={<Button variant="outline" size="touch" />}
            >
              {copy.annuler}
            </AlertDialog.Close>
            <Button
              variant="outline"
              size="touch"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {copy.confirmer}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog.Root>
    </section>
  );
}

function markAnnouncement({ etape, status }: StepMarkRequest) {
  const copy = fr.sinistres.detail.annonce;
  if (status === StepStatus.FAIT) return copy.fait(etape);
  if (status === StepStatus.NON_APPLICABLE) return copy.nonApplicable(etape);
  return copy.annule(etape);
}
