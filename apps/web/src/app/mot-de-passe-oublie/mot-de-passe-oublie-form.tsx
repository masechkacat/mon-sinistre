'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { AnnouncedResult } from '@/components/announced-result';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { EmailField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { validateEmail } from '@/lib/email-pattern';
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
          <EmailField
            label={fr.compte.motDePasseOublie.emailLabel}
            placeholder={fr.compte.motDePasseOublie.emailPlaceholder}
            value={email}
            onValueChange={(next) => {
              setEmail(next);
              setEmailError(undefined);
            }}
            error={emailError}
          />

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
