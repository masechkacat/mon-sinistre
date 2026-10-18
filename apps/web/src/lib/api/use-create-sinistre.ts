'use client';

import { useMutation } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import type {
  CreateSinistreInput,
  SinistreConflict,
} from '@mon-sinistre/contracts';
import { createSinistre, sinistreConflictOf } from './sinistres';

/**
 * Saves a dossier and opens it. `conflict` is the question the API asked back
 * (the `ExistingDossier` screen) and `confirmNew` answers it with the same
 * request again, this time asking for a second dossier.
 *
 * The conflict lives in state rather than being read off `mutation.error`:
 * the confirming request clears that error while it is in flight, and the
 * screen asking the question must not blink back to the one it replaced —
 * nor disappear if that request then fails, since it holds the only link to
 * the dossier already there.
 *
 * `current` is the dossier on screen, for a screen that can move on to
 * another one while the answer to the one sent is still held
 * (`keepPreviousData` on `/dossier`): that answer is then withheld.
 */
export function useCreateSinistre(current?: CreateSinistreInput) {
  const router = useRouter();
  const [conflict, setConflict] = useState<SinistreConflict | null>(null);

  const mutation = useMutation({
    mutationFn: createSinistre,
    onMutate: ({ confirmNew }) => {
      if (!confirmNew) setConflict(null);
    },
    onError: (error) => {
      const asked = sinistreConflictOf(error);
      if (asked) setConflict(asked);
    },
    onSuccess: (sinistre) => {
      // typedRoutes cannot check a path built from a runtime id.
      router.push(`/sinistres/${sinistre.id}` as Route);
    },
  });

  const sent = mutation.variables;
  const stale =
    current !== undefined &&
    sent !== undefined &&
    (sent.codeInsee !== current.codeInsee ||
      sent.risque !== current.risque ||
      sent.eventDate !== current.eventDate);

  return {
    mutation,
    conflict: stale ? null : conflict,
    /** The request failed for a reason the screen can only report, not act on. */
    failed:
      !stale && mutation.isError && sinistreConflictOf(mutation.error) === null,
    confirmNew: () => {
      const sent = mutation.variables;
      if (sent) mutation.mutate({ ...sent, confirmNew: true });
    },
    /** Synchronous, so the screen given back can take the focus at once. */
    dismissConflict: () => {
      flushSync(() => {
        setConflict(null);
        mutation.reset();
      });
    },
  };
}
