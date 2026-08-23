'use client';

import { Field } from '@base-ui/react/field';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
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
import { validateEmail } from '@/lib/email-pattern';
import { cn } from '@/lib/utils';
import { fr } from '@/i18n/fr';

interface RequestResetInput {
  email: string;
}

// The API answers 204 whatever the address turns out to be
// (apps/api/src/auth/CLAUDE.md, "requestPasswordReset") — this form has
// exactly one outcome to show on a successful submit, never a branch on
// whether the account exists.
export function MotDePasseOublieForm() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();

  const mutation = useMutation({
    mutationFn: (input: RequestResetInput) =>
      apiFetch<void>('/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const nextEmailError = validateEmail(trimmedEmail, {
      required: fr.compte.motDePasseOublie.emailRequiredError,
      invalid: fr.compte.motDePasseOublie.emailInvalidError,
    });

    setEmailError(nextEmailError);
    if (nextEmailError) return;

    mutation.mutate({ email: trimmedEmail });
  };

  return (
    <AnnouncedResult
      result={mutation.isSuccess ? fr.compte.motDePasseOublie.sent : undefined}
      announce={mutation.isSuccess}
      testId="mot-de-passe-oublie-sent"
    >
      <PageContainer className="space-y-8">
        <section className="space-y-4">
          <PageTitle>{fr.compte.motDePasseOublie.page.title}</PageTitle>
          <p className="text-lg text-muted-foreground">
            {fr.compte.motDePasseOublie.lead}
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
              {fr.compte.motDePasseOublie.emailLabel}
            </Field.Label>
            <Field.Control
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(undefined);
              }}
              placeholder={fr.compte.motDePasseOublie.emailPlaceholder}
              className={cn(
                inputFrameClassName,
                'w-full px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50',
                emailError && inputFrameInvalidClassName,
              )}
            />
            <FieldError error={emailError} />
          </Field.Root>

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? fr.compte.motDePasseOublie.submitting
              : fr.compte.motDePasseOublie.submit}
          </Button>

          {mutation.isError ? <RequestError /> : null}
        </form>
      </PageContainer>
    </AnnouncedResult>
  );
}
