'use client';

import { Field } from '@base-ui/react/field';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { isIsoDate, type IsoDate } from '@mon-sinistre/contracts';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import {
  inputControlClassName,
  inputFrameClassName,
  inputFrameInvalidClassName,
} from '@/components/ui/input';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/keys';
import { setSinistreDeclarationDate } from '@/lib/api/sinistres';
import { cn } from '@/lib/utils';

/**
 * The déclaration date of the step it belongs to: the field in the strip
 * while nothing is recorded, then — the date being what closes the step — the
 * day it was done and the way back, on the step's line in the row of what is
 * behind. The date is the action of this step (ТЗ § 3.4), so it has no
 * heading of its own. The step changes lists with the date, and this strip
 * is remounted with it, so the focus after a save or a clear is the step's
 * own, placed by `onApplied` like the focus after a mark.
 */
export function DeclarationStrip({
  sinistreId,
  declarationDate,
  onAnnounce,
  onApplied,
}: {
  sinistreId: string;
  declarationDate: IsoDate | null;
  onAnnounce: (message: string) => void;
  onApplied: () => void;
}) {
  const copy = fr.sinistres.detail.declaration;
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: IsoDate | null) =>
      setSinistreDeclarationDate(sinistreId, next),
    onSuccess: (detail) => {
      onAnnounce(detail.declarationDate ? copy.enregistree : copy.effacee);
      onApplied();
      queryClient.setQueryData(queryKeys.sinistre(sinistreId), detail);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sinistres(),
        exact: true,
      });
    },
    onError: (_error, next) => {
      if (next === null) onAnnounce(copy.effacementEchec);
    },
  });

  if (declarationDate) {
    return (
      <>
        <span>{fr.deadlineBadge.fait(formatDateFr(declarationDate))}</span>
        <Button
          variant="link"
          size="touch"
          disabled={mutation.isPending}
          // The control disables itself mid-action: a plain `disabled` would
          // drop the keyboard user to <body> and leave them there if the
          // request fails (as in `espace-personnel.tsx`).
          focusableWhenDisabled
          onClick={() => mutation.mutate(null)}
        >
          {copy.effacer}
        </Button>
      </>
    );
  }

  // Every failure the form can see is a failed save: a clear that fails leaves
  // the date recorded, and the strip then shows the date instead of the form.
  // The API's own French sentence for a rejected date is shown as is.
  const apiError =
    mutation.error instanceof ApiError && mutation.error.status === 400
      ? mutation.error.detail
      : undefined;

  return (
    <DeclarationForm
      pending={mutation.isPending}
      echec={mutation.isError ? (apiError ?? copy.echec) : undefined}
      onSave={(date) => mutation.mutate(date)}
      onEdit={() => {
        if (mutation.isError) mutation.reset();
      }}
    />
  );
}

function DeclarationForm({
  pending,
  echec,
  onSave,
  onEdit,
}: {
  pending: boolean;
  echec?: string;
  onSave: (date: IsoDate) => void;
  onEdit: () => void;
}) {
  const copy = fr.sinistres.detail.declaration;
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string>();
  const error = draftError ?? echec;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isIsoDate(draft)) {
      setDraftError(copy.requis);
      return;
    }
    setDraftError(undefined);
    onSave(draft);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <Field.Root invalid={Boolean(error)} className="space-y-1.5">
        <Field.Label className="block text-sm font-medium">
          {copy.label}
        </Field.Label>
        <Field.Description className="block text-sm text-muted-foreground">
          {copy.hint}
        </Field.Description>
        <Field.Control
          type="date"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftError(undefined);
            onEdit();
          }}
          className={cn(
            inputFrameClassName,
            inputControlClassName,
            error && inputFrameInvalidClassName,
          )}
        />
        <FieldError error={error} />
      </Field.Root>
      <Button
        type="submit"
        size="touch"
        disabled={pending}
        focusableWhenDisabled
      >
        {copy.enregistrer}
      </Button>
    </form>
  );
}
