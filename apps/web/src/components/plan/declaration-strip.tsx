'use client';

import { Field } from '@base-ui/react/field';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
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
 * The déclaration date inside the strip of the step it belongs to: the field
 * while nothing is recorded, then the day it was done and the way back. The
 * date is the action of this step (ТЗ § 3.4), so it has no heading of its own.
 */
export function DeclarationStrip({
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
  const fieldRef = useRef<HTMLInputElement>(null);
  const effacerRef = useRef<HTMLButtonElement>(null);
  // The strip trades the form for the recorded date and back, so the control
  // that was acted on is gone by the time the answer is rendered: the focus
  // can only follow once its replacement is mounted, hence the effect below.
  const focusApres = useRef<'champ' | 'effacer' | null>(null);
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
      focusApres.current = detail.declarationDate ? 'effacer' : 'champ';
    },
    onError: (_error, next) => {
      if (next === null) onAnnounce(copy.effacementEchec);
    },
  });

  useEffect(() => {
    const cible = focusApres.current;
    if (!cible) return;
    focusApres.current = null;
    (cible === 'champ' ? fieldRef.current : effacerRef.current)?.focus();
  }, [declarationDate]);

  if (declarationDate) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <p className="font-bold">
          {fr.deadlineBadge.fait(formatDateFr(declarationDate))}
        </p>
        <Button
          ref={effacerRef}
          variant="outline"
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
      </div>
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
      fieldRef={fieldRef}
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
  fieldRef,
  pending,
  echec,
  onSave,
  onEdit,
}: {
  fieldRef: RefObject<HTMLInputElement | null>;
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
          ref={fieldRef}
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
