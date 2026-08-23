'use client';

import { Field } from '@base-ui/react/field';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
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
import { validatePassword } from '@/lib/password-pattern';
import { cn } from '@/lib/utils';
import { fr } from '@/i18n/fr';

interface RegisterInput {
  email: string;
  password: string;
}

export function InscriptionForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();

  const mutation = useMutation({
    mutationFn: (input: RegisterInput) =>
      apiFetch<void>('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const nextEmailError = validateEmail(trimmedEmail, {
      required: fr.compte.inscription.emailRequiredError,
      invalid: fr.compte.inscription.emailInvalidError,
    });
    const nextPasswordError = validatePassword(password, {
      required: fr.compte.inscription.passwordRequiredError,
      requirements: fr.compte.inscription.passwordRequirementsError,
    });

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) return;

    mutation.mutate({ email: trimmedEmail, password });
  };

  return (
    <AnnouncedResult
      result={
        mutation.isSuccess ? fr.compte.inscription.confirmationSent : undefined
      }
      announce={mutation.isSuccess}
      testId="inscription-confirmation"
    >
      <PageContainer className="space-y-8">
        <section className="space-y-4">
          <PageTitle>{fr.compte.inscription.page.title}</PageTitle>
          <p className="text-lg text-muted-foreground">
            {fr.compte.inscription.lead}
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
              {fr.compte.inscription.emailLabel}
            </Field.Label>
            <Field.Control
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(undefined);
              }}
              placeholder={fr.compte.inscription.emailPlaceholder}
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
              {fr.compte.inscription.passwordLabel}
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

          <p className="text-sm text-muted-foreground">
            {fr.compte.inscription.purpose}{' '}
            <Link
              href="/politique-de-confidentialite"
              className="underline underline-offset-4"
            >
              {fr.compte.inscription.privacyPolicyLink}
            </Link>
          </p>

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? fr.compte.inscription.submitting
              : fr.compte.inscription.submit}
          </Button>

          <p className="text-sm">
            {fr.compte.inscription.alreadyRegistered}{' '}
            <Link href="/connexion" className="underline underline-offset-4">
              {fr.compte.inscription.loginLink}
            </Link>
          </p>

          {mutation.isError ? <RequestError /> : null}
        </form>
      </PageContainer>
    </AnnouncedResult>
  );
}
