'use client';

import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SinistreConflict } from '@mon-sinistre/contracts';
import { AnnouncedResult } from '@/components/announced-result';
import { RequestError } from '@/components/request-error';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { cn } from '@/lib/utils';

/**
 * The question a `409` from `POST /sinistres` raises: a dossier for this
 * commune and risque is already open under another date. Replaces `children`
 * — the form or the aperçu the attempt came from — so that the controls which
 * asked are gone and the two answers are what is left.
 */
export function DossierExistant({
  conflict,
  onConfirmNew,
  pending = false,
  failed = false,
  children,
}: {
  conflict: SinistreConflict | null;
  onConfirmNew: () => void;
  /** The confirming request is in flight; the question stays on screen. */
  pending?: boolean;
  /** That request failed: the question is still the way out of this screen. */
  failed?: boolean;
  children: ReactNode;
}) {
  const existant = conflict?.existing;

  return (
    <AnnouncedResult
      result={
        existant
          ? {
              title: fr.sinistres.doublon.titre,
              description: fr.sinistres.doublon.texte(
                formatDateFr(existant.eventDate),
              ),
            }
          : undefined
      }
      // A conflict is never reached by a plain page load — it only ever
      // answers an attempt to save — so it is always announced.
      announce={existant !== undefined}
      resultAction={
        existant ? (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-4">
              <Link
                href={`/sinistres/${existant.id}` as Route}
                // Both answers lead away from this screen, so neither stays
                // live while the other is in flight: leaving for the existing
                // dossier mid-request would create the second one behind the
                // visitor's back. `pointer-events-none` stops the pointer,
                // `preventDefault` the keyboard.
                aria-disabled={pending}
                onClick={(event) => {
                  if (pending) event.preventDefault();
                }}
                className={cn(
                  buttonVariants({ size: 'touch' }),
                  pending && 'pointer-events-none opacity-50',
                )}
              >
                {fr.sinistres.doublon.ouvrir}
              </Link>
              <Button
                variant="outline"
                size="touch"
                onClick={onConfirmNew}
                disabled={pending}
              >
                {pending
                  ? fr.sinistres.nouveau.submitting
                  : fr.sinistres.doublon.creer}
              </Button>
            </div>
            {failed ? <RequestError /> : null}
          </div>
        ) : undefined
      }
      testId="dossier-existant"
    >
      {children}
    </AnnouncedResult>
  );
}
