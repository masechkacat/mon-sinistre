'use client';

import { Field } from '@base-ui/react/field';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { CommuneMultiSelect } from '@/components/commune-multi-select';
import { MessageScreen } from '@/components/message-screen';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
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

  if (mutation.isSuccess) {
    return (
      <div role="status">
        <MessageScreen
          title={fr.veille.confirmationSent.title}
          description={fr.veille.confirmationSent.description}
        />
      </div>
    );
  }

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
            className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40"
          />
          {emailError ? (
            <Field.Error
              match
              role="alert"
              className="text-sm text-destructive"
            >
              {emailError}
            </Field.Error>
          ) : null}
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
  );
}
