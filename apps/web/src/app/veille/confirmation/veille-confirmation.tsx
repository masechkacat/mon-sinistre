'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import type {
  VeilleConfirmationResponse,
  VeilleConfirmationStatus,
} from '@mon-sinistre/contracts';
import { AnnouncedResult } from '@/components/announced-result';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/keys';
import { fr } from '@/i18n/fr';

export function VeilleConfirmation() {
  const searchParams = useSearchParams();
  const rawToken = searchParams.get('token');
  const hasToken = typeof rawToken === 'string' && rawToken.length > 0;
  const token = rawToken ?? '';

  const statusQuery = useQuery({
    queryKey: queryKeys.veilleConfirmation(token),
    queryFn: () =>
      apiFetch<VeilleConfirmationResponse>(
        `/veille/confirmation?token=${encodeURIComponent(token)}`,
      ),
    enabled: hasToken,
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      apiFetch<VeilleConfirmationResponse>('/veille/confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
  });

  const status: VeilleConfirmationStatus | undefined = !hasToken
    ? 'invalid'
    : (confirmMutation.data?.status ?? statusQuery.data?.status);

  // A terminal status outranks a failed status GET: the query stays mounted
  // after the confirmation and refetches on window focus, and a background
  // failure must not replace "votre veille est active" with an error screen —
  // the user would read it as a confirmation that did not go through.
  const result =
    status === 'active'
      ? fr.veille.confirmation.active
      : status === 'invalid'
        ? fr.veille.confirmation.invalid
        : undefined;

  return (
    <AnnouncedResult
      result={result}
      announce={confirmMutation.isSuccess}
      testId="veille-confirmation-result"
    >
      <PageContainer className="space-y-6">
        <PageTitle>{fr.veille.confirmation.page.title}</PageTitle>
        {statusQuery.isError ? (
          // A genuine request failure (network down, API 5xx) is not a domain
          // "invalid" status — the endpoints only ever answer 200 for a bad
          // token (anti-enumeration, research § «Контракт API»). It gets the
          // same French message as everywhere else in the app, not folded
          // into "lien invalide".
          <RequestError />
        ) : status === undefined ? (
          <p className="text-lg text-muted-foreground">
            {fr.veille.confirmation.loading}
          </p>
        ) : (
          <>
            <p className="text-lg text-muted-foreground">
              {fr.veille.confirmation.pending.description}
            </p>
            <Button
              type="button"
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
            >
              {confirmMutation.isPending
                ? fr.veille.confirmation.confirming
                : fr.veille.confirmation.confirmButton}
            </Button>
            {confirmMutation.isError ? <RequestError /> : null}
          </>
        )}
      </PageContainer>
    </AnnouncedResult>
  );
}
