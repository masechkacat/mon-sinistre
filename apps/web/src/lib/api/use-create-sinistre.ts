'use client';

import { useMutation } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SinistreConflict } from '@mon-sinistre/contracts';
import { createSinistre, sinistreConflictOf } from './sinistres';

/**
 * Saves a dossier and opens it. `conflict` is the question the API asked back
 * (the `DossierExistant` screen) and `confirmNew` answers it with the same
 * request again, this time asking for a second dossier.
 *
 * The conflict lives in state rather than being read off `mutation.error`:
 * the confirming request clears that error while it is in flight, and the
 * screen asking the question must not blink back to the one it replaced —
 * nor disappear if that request then fails, since it holds the only link to
 * the dossier already there.
 */
export function useCreateSinistre() {
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
      // `/sinistres/[id]` is dynamic, and typedRoutes cannot check a path
      // built from an id known only at runtime — same cast as the list screen.
      router.push(`/sinistres/${sinistre.id}` as Route);
    },
  });

  return {
    mutation,
    conflict,
    /** The request failed for a reason the screen can only report, not act on. */
    failed: mutation.isError && sinistreConflictOf(mutation.error) === null,
    confirmNew: () => {
      const sent = mutation.variables;
      if (sent) mutation.mutate({ ...sent, confirmNew: true });
    },
  };
}
