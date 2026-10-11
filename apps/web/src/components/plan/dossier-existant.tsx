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
 * Replaces `children` — the form or the aperçu the attempt came from — rather
 * than sitting above them: the question must not be left unread above a
 * button that would only ask it again.
 */
export function DossierExistant({
  conflict,
  onConfirmNew,
  onCorriger,
  pending = false,
  failed = false,
  children,
}: {
  conflict: SinistreConflict | null;
  onConfirmNew: () => void;
  /** Neither answer: back to where the commune, risque or date can change. */
  onCorriger: () => void;
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
              <Button
                variant="ghost"
                size="touch"
                onClick={onCorriger}
                disabled={pending}
              >
                {fr.sinistres.doublon.corriger}
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
