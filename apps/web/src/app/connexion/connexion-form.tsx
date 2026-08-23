'use client';

import { Field } from '@base-ui/react/field';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { LoginResponse } from '@mon-sinistre/contracts';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { FieldError } from '@/components/field-error';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import {
  inputFrameClassName,
  inputFrameInvalidClassName,
} from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api/client';
import { setAccessToken } from '@/lib/api/session';
import { validateEmail } from '@/lib/email-pattern';
import { cn } from '@/lib/utils';
import { fr } from '@/i18n/fr';

interface LoginInput {
  email: string;
  password: string;
}

export function ConnexionForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();

  const mutation = useMutation({
    mutationFn: (input: LoginInput) =>
      apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      router.push('/espace-personnel');
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
  const requestFailed = mutation.isError && !invalidCredentials;

  return (
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
        aria-busy={mutation.isPending}
      >
        <Field.Root invalid={Boolean(emailError)} className="space-y-1.5">
          <Field.Label className="block text-sm font-medium">
            {fr.compte.connexion.emailLabel}
          </Field.Label>
          <Field.Control
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError(undefined);
            }}
            placeholder={fr.compte.connexion.emailPlaceholder}
            className={cn(
              inputFrameClassName,
              'w-full px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50',
              emailError && inputFrameInvalidClassName,
            )}
          />
          <FieldError error={emailError} />
        </Field.Root>

        <Field.Root invalid={Boolean(passwordError)} className="space-y-1.5">
          <Field.Label className="block text-sm font-medium">
            {fr.compte.connexion.passwordLabel}
          </Field.Label>
          <Field.Control
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordError(undefined);
            }}
            className={cn(
              inputFrameClassName,
              'w-full px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50',
              passwordError && inputFrameInvalidClassName,
            )}
          />
          <FieldError error={passwordError} />
        </Field.Root>

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? fr.compte.connexion.submitting
            : fr.compte.connexion.submit}
        </Button>

        {invalidCredentials ? (
          <Alert variant="destructive" data-testid="connexion-error">
            <AlertTitle>{fr.compte.connexion.invalidError}</AlertTitle>
          </Alert>
        ) : null}
        {requestFailed ? <RequestError /> : null}
      </form>
    </PageContainer>
  );
}
