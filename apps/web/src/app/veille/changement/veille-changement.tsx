'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import type {
  VeilleChangeResponse,
  VeilleChangeStatus,
} from '@mon-sinistre/contracts';
import { AnnouncedResult } from '@/components/announced-result';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/keys';
import { communeLabel } from '@/lib/commune-label';
import { fr } from '@/i18n/fr';

export function VeilleChangement() {
  const searchParams = useSearchParams();
  const rawToken = searchParams.get('token');
  const hasToken = typeof rawToken === 'string' && rawToken.length > 0;
  const token = rawToken ?? '';

  const statusQuery = useQuery({
    queryKey: queryKeys.veilleChange(token),
    queryFn: () =>
      apiFetch<VeilleChangeResponse>(
        `/veille/changement?token=${encodeURIComponent(token)}`,
      ),
    enabled: hasToken,
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      apiFetch<VeilleChangeResponse>('/veille/changement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
  });

  const status: VeilleChangeStatus | undefined = !hasToken
    ? 'invalid'
    : (applyMutation.data?.status ?? statusQuery.data?.status);

  // Same priority rule as veille-confirmation.tsx: a terminal status outranks
  // a failed background status GET, so a refetch failure after applying the
  // change cannot replace "modification appliquée" with an error screen.
  const result =
    status === 'applied'
      ? fr.veille.change.applied
      : status === 'invalid'
        ? fr.veille.change.invalid
        : undefined;

  return (
    <AnnouncedResult
      result={result}
      announce={applyMutation.isSuccess}
      testId="veille-change-result"
    >
      <PageContainer className="space-y-6">
        <PageTitle>{fr.veille.change.page.title}</PageTitle>
        {statusQuery.isError ? (
          // Same distinction as veille-confirmation.tsx, same reason.
          <RequestError />
        ) : status === undefined ? (
          <p className="text-lg text-muted-foreground">
            {fr.veille.change.loading}
          </p>
        ) : (
          <>
            <p className="text-lg text-muted-foreground">
              {fr.veille.change.pending.description}
            </p>
            <ul className="list-disc space-y-1 pl-6 text-lg text-muted-foreground">
              {(statusQuery.data?.communes ?? []).map((commune) => (
                <li key={`${commune.name}-${commune.departementName}`}>
                  {communeLabel(commune)}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending}
            >
              {applyMutation.isPending
                ? fr.veille.change.confirming
                : fr.veille.change.confirmButton}
            </Button>
            {applyMutation.isError ? <RequestError /> : null}
          </>
        )}
      </PageContainer>
    </AnnouncedResult>
  );
}
