'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentUserResponse } from '@mon-sinistre/contracts';
import Link from 'next/link';
import { fr } from '@/i18n/fr';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { Button, buttonVariants } from '@/components/ui/button';
import { deleteAccount, fetchCurrentUser } from '@/lib/api/account';
import { queryKeys } from '@/lib/api/keys';
import { updateReminders } from '@/lib/api/reminders';
import { clearSessionAndNavigate, endSession } from '@/lib/api/session';
import { useSessionGuard } from '@/lib/api/use-session-guard';
import { focusOnMount } from '@/lib/focus-on-mount';

/** Public landing page after account deletion — no session guard, there is
 * no account left to check one against. */
const ACCOUNT_DELETED_PATH = '/compte-supprime';
const DELETE_PANEL_ID = 'delete-account-confirm';

export function EspacePersonnel() {
  const status = useSessionGuard();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

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

            <Link
              href="/sinistres"
              className={buttonVariants({ variant: 'outline', size: 'touch' })}
            >
              {fr.compte.espacePersonnel.sinistresLink}
            </Link>

            <Button type="button" size="touch" onClick={() => endSession()}>
              {fr.session.logout}
            </Button>

            {userQuery.data ? (
              <RemindersSection enabled={userQuery.data.remindersEnabled} />
            ) : null}

            <section className="space-y-3 border-t pt-6">
              <h2 className="text-xl font-semibold">
                {fr.compte.espacePersonnel.deleteAccount.heading}
              </h2>
              {/* Disclosure (ARIA APG): the trigger stays on the page while
                  the panel is open, so closing it hands the focus back from
                  the event itself — no node to wait for. */}
              <Button
                ref={deleteTriggerRef}
                type="button"
                variant="outline"
                size="touch"
                aria-expanded={confirmingDelete}
                aria-controls={DELETE_PANEL_ID}
                onClick={() => setConfirmingDelete((open) => !open)}
              >
                {fr.compte.espacePersonnel.deleteAccount.button}
              </Button>
              {confirmingDelete ? (
                // Not `role="alert"` (Alert component): that role is for
                // time-sensitive notifications, not for a panel that itself
                // holds the interactive controls — `role="group"` plus an
                // explicit accessible name is the pattern for a disclosure like
                // this one, and it is what receives focus on opening.
                <div
                  id={DELETE_PANEL_ID}
                  ref={focusOnMount}
                  tabIndex={-1}
                  role="group"
                  aria-labelledby="delete-account-warning-title"
                  aria-describedby="delete-account-warning-description"
                  data-testid="delete-account-confirm"
                  className="space-y-3 rounded-lg border p-4 outline-none"
                >
                  <p
                    id="delete-account-warning-title"
                    className="font-medium text-destructive"
                  >
                    {fr.compte.espacePersonnel.deleteAccount.warning.title}
                  </p>
                  <p
                    id="delete-account-warning-description"
                    className="text-sm"
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
                      size="touch"
                      onClick={() => {
                        setConfirmingDelete(false);
                        deleteTriggerRef.current?.focus();
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      {fr.compte.espacePersonnel.deleteAccount.cancel}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="touch"
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
              ) : null}
            </section>
          </div>
        )}
      </div>
    </PageContainer>
  );
}

function RemindersSection({ enabled }: { enabled: boolean }) {
  const copy = fr.compte.espacePersonnel.rappels;
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: updateReminders,
    onSuccess: ({ enabled }) =>
      queryClient.setQueryData<CurrentUserResponse>(
        queryKeys.currentUser(),
        (user) => user && { ...user, remindersEnabled: enabled },
      ),
  });

  return (
    <section className="space-y-3 border-t pt-6">
      <h2 className="text-xl font-semibold">{copy.heading}</h2>
      {/* The sentence on screen is also the live region: it is mounted with
          its text, which is the case screen readers skip (apps/web/CLAUDE.md)
          — exactly right here, since arriving on the page announces nothing
          and only a change the person made is read out. */}
      <p role="status" data-testid="rappels-etat">
        {enabled ? copy.enabled : copy.disabled}
      </p>
      {/* `touch` like the button behind the link in the mail: the same action
          reached the other way. `focusableWhenDisabled` because the control
          disables itself mid-action — a plain `disabled` drops the keyboard
          user to <body> and never lets them hear the pending label. */}
      <Button
        type="button"
        variant="outline"
        size="touch"
        onClick={() => mutation.mutate(!enabled)}
        disabled={mutation.isPending}
        focusableWhenDisabled
      >
        {mutation.isPending
          ? copy.updating
          : enabled
            ? copy.disable
            : copy.enable}
      </Button>
      {mutation.isError ? <RequestError /> : null}
    </section>
  );
}
