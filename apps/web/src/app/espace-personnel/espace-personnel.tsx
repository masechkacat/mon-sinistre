'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fr } from '@/i18n/fr';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { Button, buttonVariants } from '@/components/ui/button';
import { deleteAccount, fetchCurrentUser } from '@/lib/api/account';
import { queryKeys } from '@/lib/api/keys';
import { clearSessionAndNavigate, endSession } from '@/lib/api/session';
import { useSessionGuard } from '@/lib/api/use-session-guard';
import { useFocusOnSuccess } from '@/lib/use-focus-on-success';

/** Public landing page after account deletion — no session guard, there is
 * no account left to check one against. */
const ACCOUNT_DELETED_PATH = '/compte-supprime';

export function EspacePersonnel() {
  const status = useSessionGuard();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmPanelRef = useFocusOnSuccess(confirmingDelete);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  // Disclosure pattern (ARIA APG): closing the panel must return focus to
  // the control that opened it, or a keyboard/screen-reader user is
  // stranded at <body>. `wasConfirmingRef` distinguishes "just closed" from
  // "never opened" — the trigger has not mounted yet on first render, so an
  // unconditional focus on `!confirmingDelete` would steal focus on load.
  const wasConfirmingRef = useRef(false);
  useEffect(() => {
    if (!confirmingDelete && wasConfirmingRef.current) {
      deleteTriggerRef.current?.focus();
    }
    wasConfirmingRef.current = confirmingDelete;
  }, [confirmingDelete]);

  const userQuery = useQuery({
    queryKey: queryKeys.currentUser(),
    queryFn: fetchCurrentUser,
    enabled: status === 'authenticated',
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => clearSessionAndNavigate(ACCOUNT_DELETED_PATH),
  });

  // The page keeps its chrome while the silent refresh runs: an early return
  // of the bare status line would leave the document with no `h1` at all
  // (WCAG 2.1 AA, axe `page-has-heading-one`) for as long as the check takes,
  // and the title is already true — this is the espace personnel, loading.
  // `aria-busy` rather than a `role="status"` region: the region would be
  // mounted with its text already inside, which is the case screen readers
  // routinely fail to announce (see components/announced-result.tsx), so it
  // would cost a live region and announce nothing.
  return (
    <PageContainer className="space-y-6">
      <PageTitle>{fr.compte.espacePersonnel.page.title}</PageTitle>

      <div className="space-y-6" aria-busy={status === 'checking'}>
        {status === 'checking' ? (
          <p
            data-testid="session-status"
            className="text-lg text-muted-foreground"
          >
            {fr.session.checking}
          </p>
        ) : (
          <div data-testid="espace-personnel-content" className="space-y-6">
            <p className="text-lg text-muted-foreground">
              {fr.compte.espacePersonnel.intro}
            </p>
            {userQuery.data ? (
              <p data-testid="espace-personnel-email">
                <span className="font-medium">
                  {fr.compte.espacePersonnel.emailLabel}{' '}
                </span>
                {userQuery.data.email}
              </p>
            ) : null}
            {userQuery.isError ? <RequestError /> : null}

            <Button type="button" onClick={() => endSession()}>
              {fr.session.logout}
            </Button>

            <div className="space-y-3 border-t pt-6">
              {!confirmingDelete ? (
                // A plain button, not <Button>: it needs a real DOM ref to
                // receive focus back when the panel below closes (see
                // `wasConfirmingRef` above), and the wrapper component does not
                // forward one — `buttonVariants` keeps the same look without
                // re-deriving it.
                <button
                  ref={deleteTriggerRef}
                  type="button"
                  className={buttonVariants({ variant: 'destructive' })}
                  onClick={() => setConfirmingDelete(true)}
                >
                  {fr.compte.espacePersonnel.deleteAccount.button}
                </button>
              ) : (
                // Not `role="alert"` (Alert component): that role is for
                // time-sensitive notifications, not for a panel that itself
                // holds the interactive controls — `role="group"` plus an
                // explicit accessible name is the pattern for a disclosure like
                // this one, and it is what receives focus below.
                <div
                  ref={confirmPanelRef}
                  tabIndex={-1}
                  role="group"
                  aria-labelledby="delete-account-warning-title"
                  aria-describedby="delete-account-warning-description"
                  data-testid="delete-account-confirm"
                  className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 outline-none"
                >
                  <p
                    id="delete-account-warning-title"
                    className="font-medium text-destructive"
                  >
                    {fr.compte.espacePersonnel.deleteAccount.warning.title}
                  </p>
                  <p
                    id="delete-account-warning-description"
                    className="text-sm text-muted-foreground"
                  >
                    {
                      fr.compte.espacePersonnel.deleteAccount.warning
                        .description
                    }
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={deleteMutation.isPending}
                    >
                      {fr.compte.espacePersonnel.deleteAccount.cancel}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate()}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending
                        ? fr.compte.espacePersonnel.deleteAccount.deleting
                        : fr.compte.espacePersonnel.deleteAccount.confirm}
                    </Button>
                  </div>
                  {deleteMutation.isError ? <RequestError /> : null}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
