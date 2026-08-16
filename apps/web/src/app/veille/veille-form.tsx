'use client';

import { Field } from '@base-ui/react/field';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { AnnouncedResult } from '@/components/announced-result';
import { CommuneMultiSelect } from '@/components/commune-multi-select';
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
import { cn } from '@/lib/utils';
import { fr } from '@/i18n/fr';

// Deliberately permissive: the server-side @IsEmail (apps/api) is the
// authority, this only screens obviously incomplete input before the
// request leaves the browser.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SubscribeInput {
  email: string;
  communeCodes: string[];
}

export function VeilleForm() {
  const [email, setEmail] = useState('');
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [emailError, setEmailError] = useState<string>();
  const [communesError, setCommunesError] = useState<string>();

  const mutation = useMutation({
    mutationFn: (input: SubscribeInput) =>
      apiFetch<void>('/veille', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const nextEmailError =
      trimmedEmail === ''
        ? fr.veille.form.emailRequiredError
        : !EMAIL_PATTERN.test(trimmedEmail)
          ? fr.veille.form.emailInvalidError
          : undefined;
    const nextCommunesError =
      communes.length === 0 ? fr.veille.form.communesRequiredError : undefined;

    setEmailError(nextEmailError);
    setCommunesError(nextCommunesError);
    if (nextEmailError || nextCommunesError) return;

    mutation.mutate({
      email: trimmedEmail,
      communeCodes: communes.map((commune) => commune.codeInsee),
    });
  };

  return (
    <>
      {mutation.isSuccess ? (
        <AnnouncedResult
          title={fr.veille.confirmationSent.title}
          description={fr.veille.confirmationSent.description}
          announce={mutation.isSuccess}
          testId="veille-confirmation"
        />
      ) : (
        <PageContainer className="space-y-8">
          <section className="space-y-4">
            <PageTitle>{fr.veille.page.title}</PageTitle>
            <p className="text-lg text-muted-foreground">
              {fr.veille.page.lead}
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
                {fr.veille.form.emailLabel}
              </Field.Label>
              <Field.Control
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(undefined);
                }}
                placeholder={fr.veille.form.emailPlaceholder}
                className={cn(
                  inputFrameClassName,
                  'w-full px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50',
                  emailError && inputFrameInvalidClassName,
                )}
              />
              <FieldError error={emailError} />
            </Field.Root>

            <CommuneMultiSelect
              value={communes}
              onValueChange={(next) => {
                setCommunes(next);
                if (next.length > 0) setCommunesError(undefined);
              }}
              error={communesError}
            />

            <p className="text-sm text-muted-foreground">
              {fr.veille.form.purpose}{' '}
              <Link
                href="/politique-de-confidentialite"
                className="underline underline-offset-4"
              >
                {fr.veille.form.privacyPolicyLink}
              </Link>
            </p>

            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? fr.veille.form.submitting
                : fr.veille.form.submit}
            </Button>

            {mutation.isError ? <RequestError /> : null}
          </form>
        </PageContainer>
      )}
    </>
  );
}
