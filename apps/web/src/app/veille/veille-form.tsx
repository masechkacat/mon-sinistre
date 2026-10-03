'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { AnnouncedResult } from '@/components/announced-result';
import { CommuneMultiSelect } from '@/components/commune-multi-select';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { EmailField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { validateEmail } from '@/lib/email-pattern';
import { fr } from '@/i18n/fr';

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
    const nextEmailError = validateEmail(trimmedEmail, {
      required: fr.veille.form.emailRequiredError,
      invalid: fr.veille.form.emailInvalidError,
    });
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
    <AnnouncedResult
      result={mutation.isSuccess ? fr.veille.confirmationSent : undefined}
      announce={mutation.isSuccess}
      testId="veille-confirmation"
    >
      <PageContainer className="space-y-8">
        <section className="space-y-4">
          <PageTitle>{fr.veille.page.title}</PageTitle>
          <p className="text-lg text-muted-foreground">{fr.veille.page.lead}</p>
        </section>

        <form
          className="space-y-6"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={mutation.isPending}
        >
          <EmailField
            label={fr.veille.form.emailLabel}
            placeholder={fr.veille.form.emailPlaceholder}
            value={email}
            onValueChange={(next) => {
              setEmail(next);
              setEmailError(undefined);
            }}
            error={emailError}
          />

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
    </AnnouncedResult>
  );
}
