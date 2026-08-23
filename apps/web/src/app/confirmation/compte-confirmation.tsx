'use client';

import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import type {
  AccountConfirmationResponse,
  AccountConfirmationStatus,
} from '@mon-sinistre/contracts';
import { AnnouncedResult } from '@/components/announced-result';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { fr } from '@/i18n/fr';

// Unlike veille's confirmation page, there is no GET status endpoint here
// (apps/api/src/auth/CLAUDE.md: "у эндпоинта нет GET-пары") — visiting the
// link never activates the account by itself, on purpose, so this page has
// nothing to poll on mount. The button always starts visible for a present
// token; only the POST click can change the status.
export function CompteConfirmation() {
  const searchParams = useSearchParams();
  const rawToken = searchParams.get('token');
  const hasToken = typeof rawToken === 'string' && rawToken.length > 0;
  const token = rawToken ?? '';

  const confirmMutation = useMutation({
    mutationFn: () =>
      apiFetch<AccountConfirmationResponse>('/auth/confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
  });

  const status: AccountConfirmationStatus | undefined = !hasToken
    ? 'invalid'
    : confirmMutation.data?.status;

  const result =
    status === 'confirmed'
      ? fr.compte.confirmation.confirmed
      : status === 'invalid'
        ? fr.compte.confirmation.invalid
        : undefined;

  return (
    <AnnouncedResult
      result={result}
      announce={confirmMutation.isSuccess}
      testId="compte-confirmation-result"
    >
      <PageContainer className="space-y-6">
        <PageTitle>{fr.compte.confirmation.page.title}</PageTitle>
        <p className="text-lg text-muted-foreground">
          {fr.compte.confirmation.pending.description}
        </p>
        <Button
          type="button"
          onClick={() => confirmMutation.mutate()}
          disabled={confirmMutation.isPending}
        >
          {confirmMutation.isPending
            ? fr.compte.confirmation.confirming
            : fr.compte.confirmation.confirmButton}
        </Button>
        {confirmMutation.isError ? <RequestError /> : null}
      </PageContainer>
    </AnnouncedResult>
  );
}
