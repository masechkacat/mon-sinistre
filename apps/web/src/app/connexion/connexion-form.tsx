'use client';

import { useMutation } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import type { LoginResponse } from '@mon-sinistre/contracts';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { ExistingDossier } from '@/components/plan/existing-dossier';
import { RequestError } from '@/components/request-error';
import { EmailField, PasswordField } from '@/components/text-field';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api/client';
import { ESPACE_PERSONNEL_PATH, setAccessToken } from '@/lib/api/session';
import { useCreateSinistre } from '@/lib/api/use-create-sinistre';
import {
  dossierInput,
  dossierPath,
  type DossierParams,
} from '@/lib/dossier-params';
import { validateEmail } from '@/lib/email-pattern';
import { focusOnMount } from '@/lib/focus-on-mount';
import { fr } from '@/i18n/fr';

interface LoginInput {
  email: string;
  password: string;
}

export function ConnexionForm({
  params,
  suivant,
}: {
  params: DossierParams;
  suivant: Route | null;
}) {
  const router = useRouter();
  const dossier = dossierInput(params);
  const backToDossier = dossierPath('/dossier', params);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();

  const creation = useCreateSinistre();

  const mutation = useMutation({
    mutationFn: (input: LoginInput) =>
      apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      if (dossier) {
        creation.mutation.mutate(dossier);
        return;
      }
      router.push(suivant ?? ESPACE_PERSONNEL_PATH);
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const nextEmailError = validateEmail(trimmedEmail, {
      required: fr.compte.connexion.emailRequiredError,
      invalid: fr.compte.connexion.emailInvalidError,
    });
    const nextPasswordError =
      password === '' ? fr.compte.connexion.passwordRequiredError : undefined;

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) return;

    mutation.mutate({ email: trimmedEmail, password });
  };

  // One generic message for every 401 — anti-enumeration
  // (apps/api/src/auth/CLAUDE.md), the client must not try to distinguish
  // causes the API already collapsed. Any other failure (network error, 429,
  // 500) falls through to the ordinary RequestError.
  const invalidCredentials =
    mutation.isError &&
    mutation.error instanceof ApiError &&
    mutation.error.status === 401;
  const loggedIn = mutation.isSuccess && dossier !== undefined;
  const creationRefused =
    creation.mutation.error instanceof ApiError &&
    creation.mutation.error.status === 400;

  return (
    <ExistingDossier
      conflict={creation.conflict}
      onConfirmNew={creation.confirmNew}
      onEdit={() => router.push(backToDossier)}
      pending={creation.mutation.isPending}
      failed={creation.failed}
    >
      <PageContainer className="space-y-8">
        <section className="space-y-4">
          <PageTitle>{fr.compte.connexion.page.title}</PageTitle>
          <p className="text-lg text-muted-foreground">
            {fr.compte.connexion.lead}
          </p>
        </section>

        <p
          role="status"
          className="text-lg text-muted-foreground empty:sr-only"
        >
          {loggedIn && creation.mutation.isPending ? fr.dossier.saving : null}
        </p>

        {loggedIn && creation.failed ? (
          <div
            ref={focusOnMount}
            tabIndex={-1}
            className="space-y-6 outline-none"
          >
            <p className="text-lg">{fr.dossier.failureAfterLogin}</p>
            <RequestError />
            <div className="flex flex-wrap gap-4">
              {creationRefused ? null : (
                <Button
                  size="touch"
                  onClick={() => creation.mutation.mutate(dossier)}
                >
                  {fr.serverError.retry}
                </Button>
              )}
              <Link
                href={backToDossier}
                className={buttonVariants({
                  size: 'touch',
                  variant: creationRefused ? 'default' : 'outline',
                })}
              >
                {fr.dossier.back}
              </Link>
            </div>
          </div>
        ) : null}

        {loggedIn ? null : (
          <form
            className="space-y-6"
            onSubmit={handleSubmit}
            noValidate
            aria-busy={mutation.isPending}
          >
            <EmailField
              label={fr.compte.connexion.emailLabel}
              placeholder={fr.compte.connexion.emailPlaceholder}
              value={email}
              onValueChange={(next) => {
                setEmail(next);
                setEmailError(undefined);
              }}
              error={emailError}
            />

            <PasswordField
              label={fr.compte.connexion.passwordLabel}
              autoComplete="current-password"
              value={password}
              onValueChange={(next) => {
                setPassword(next);
                setPasswordError(undefined);
              }}
              error={passwordError}
            />

            <p className="text-sm">
              <Link
                href="/mot-de-passe-oublie"
                className="underline underline-offset-4"
              >
                {fr.compte.connexion.forgotPasswordLink}
              </Link>
            </p>

            <Button type="submit" size="touch" disabled={mutation.isPending}>
              {mutation.isPending
                ? fr.compte.connexion.submitting
                : fr.compte.connexion.submit}
            </Button>

            <p className="text-sm">
              {fr.compte.connexion.noAccount}{' '}
              <Link
                href={dossierPath('/inscription', params)}
                className="underline underline-offset-4"
              >
                {fr.compte.connexion.registerLink}
              </Link>
            </p>

            {invalidCredentials ? (
              <Alert variant="destructive" data-testid="connexion-error">
                <AlertTitle>{fr.compte.connexion.invalidError}</AlertTitle>
              </Alert>
            ) : null}
            {mutation.isError && !invalidCredentials ? <RequestError /> : null}
          </form>
        )}
      </PageContainer>
    </ExistingDossier>
  );
}
