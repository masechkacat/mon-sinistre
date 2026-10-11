'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { LoginResponse } from '@mon-sinistre/contracts';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { DossierExistant } from '@/components/plan/dossier-existant';
import { RequestError } from '@/components/request-error';
import { EmailField, PasswordField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api/client';
import { loginNextPath, setAccessToken } from '@/lib/api/session';
import { useCreateSinistre } from '@/lib/api/use-create-sinistre';
import { dossierInput, parseDossierParams } from '@/lib/dossier-params';
import { validateEmail } from '@/lib/email-pattern';
import { fr } from '@/i18n/fr';

interface LoginInput {
  email: string;
  password: string;
}

export function ConnexionForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // A dossier still to save comes before a page to return to: it is the one
  // that would be lost.
  const dossier = dossierInput(parseDossierParams(searchParams));
  const suivant = loginNextPath(searchParams);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();

  const enregistrement = useCreateSinistre();

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
        enregistrement.mutation.mutate(dossier);
        return;
      }
      router.push(suivant ?? '/espace-personnel');
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
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
  // The save happens on this screen too, so its failure is reported under
  // the same button — but never beside the message above, which answers the
  // submit the person is looking at.
  const requestFailed =
    !invalidCredentials && (mutation.isError || enregistrement.failed);
  const pending = mutation.isPending || enregistrement.mutation.isPending;

  return (
    <DossierExistant
      conflict={enregistrement.conflict}
      onConfirmNew={enregistrement.confirmNew}
      pending={enregistrement.mutation.isPending}
      failed={enregistrement.failed}
    >
      <PageContainer className="space-y-8">
        <section className="space-y-4">
          <PageTitle>{fr.compte.connexion.page.title}</PageTitle>
          <p className="text-lg text-muted-foreground">
            {fr.compte.connexion.lead}
          </p>
        </section>

        <form
          className="space-y-6"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={pending}
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

          <Button type="submit" disabled={pending}>
            {pending
              ? fr.compte.connexion.submitting
              : fr.compte.connexion.submit}
          </Button>

          <p className="text-sm">
            {fr.compte.connexion.noAccount}{' '}
            <Link href="/inscription" className="underline underline-offset-4">
              {fr.compte.connexion.registerLink}
            </Link>
          </p>

          {invalidCredentials ? (
            <Alert variant="destructive" data-testid="connexion-error">
              <AlertTitle>{fr.compte.connexion.invalidError}</AlertTitle>
            </Alert>
          ) : null}
          {requestFailed ? <RequestError /> : null}
        </form>
      </PageContainer>
    </DossierExistant>
  );
}
