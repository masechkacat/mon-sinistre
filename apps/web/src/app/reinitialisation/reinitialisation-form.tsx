'use client';

import { Field } from '@base-ui/react/field';
import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type {
  PasswordResetStatus,
  ResetPasswordResponse,
} from '@mon-sinistre/contracts';
import { AnnouncedResult } from '@/components/announced-result';
import { FieldError } from '@/components/field-error';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import {
  inputFrameClassName,
  inputFrameInvalidClassName,
} from '@/components/ui/input';
import { apiFetch } from '@/lib/api/client';
import { validatePassword } from '@/lib/password-pattern';
import { cn } from '@/lib/utils';
import { fr } from '@/i18n/fr';

// Like CompteConfirmation, visiting the link never spends the token by
// itself — the only request this page ever sends is the form's own POST, on
// submit. A missing token answers "invalid" without one, the same as a
// token the API rejects after a submit (apps/api/src/auth/CLAUDE.md,
// "resetPassword": unknown, expired and already-used all answer alike, the
// cause not told apart). A successful reset lands on the login page instead
// of a result screen — the token was single-use, there is nothing left here
// to show.
export function ReinitialisationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawToken = searchParams.get('token');
  const hasToken = typeof rawToken === 'string' && rawToken.length > 0;
  const token = rawToken ?? '';

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string>();

  const mutation = useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      apiFetch<ResetPasswordResponse>('/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      if (data.status === 'reset') router.push('/connexion');
    },
  });

  const status: PasswordResetStatus | undefined = !hasToken
    ? 'invalid'
    : mutation.data?.status;

  const result =
    status === 'invalid' ? fr.compte.reinitialisation.invalid : undefined;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPasswordError = validatePassword(password, {
      required: fr.compte.reinitialisation.passwordRequiredError,
      requirements: fr.compte.reinitialisation.passwordRequirementsError,
    });

    setPasswordError(nextPasswordError);
    if (nextPasswordError) return;

    mutation.mutate({ token, password });
  };

  return (
    <AnnouncedResult
      result={result}
      announce={mutation.isSuccess}
      testId="reinitialisation-invalid"
    >
      <PageContainer className="space-y-8">
        <section className="space-y-4">
          <PageTitle>{fr.compte.reinitialisation.page.title}</PageTitle>
          <p className="text-lg text-muted-foreground">
            {fr.compte.reinitialisation.lead}
          </p>
        </section>

        <form
          className="space-y-6"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={mutation.isPending}
        >
          <Field.Root invalid={Boolean(passwordError)} className="space-y-1.5">
            <Field.Label className="block text-sm font-medium">
              {fr.compte.reinitialisation.passwordLabel}
            </Field.Label>
            <Field.Control
              type="password"
              autoComplete="new-password"
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
              ? fr.compte.reinitialisation.submitting
              : fr.compte.reinitialisation.submit}
          </Button>

          {mutation.isError ? <RequestError /> : null}
        </form>
      </PageContainer>
    </AnnouncedResult>
  );
}
