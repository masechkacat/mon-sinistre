'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { Commune } from '@mon-sinistre/contracts';
import { AnnouncedResult } from '@/components/announced-result';
import { PrivacyNote } from '@/components/privacy-note';
import { RequestError } from '@/components/request-error';
import { SectionHeading } from '@/components/section-heading';
import { EmailField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { subscribeVeille } from '@/lib/api/veille';
import { validateEmail } from '@/lib/email-pattern';
import { fr } from '@/i18n/fr';

const copy = fr.veille;

export function VeilleInlineForm({ commune }: { commune: Commune }) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();

  const mutation = useMutation({
    mutationFn: (value: string) => subscribeVeille(value, [commune.codeInsee]),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmailError = validateEmail(email.trim(), {
      required: copy.form.emailRequiredError,
      invalid: copy.form.emailInvalidError,
    });

    setEmailError(nextEmailError);
    if (nextEmailError) return;

    mutation.mutate(email);
  };

  return (
    <AnnouncedResult
      result={mutation.isSuccess ? copy.confirmationSent : undefined}
      announce={mutation.isSuccess}
      testId="veille-inline-confirmation"
      inline
    >
      <section className="space-y-4">
        <SectionHeading>{copy.inline.heading(commune.name)}</SectionHeading>

        <form
          className="space-y-4"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={mutation.isPending}
        >
          <EmailField
            label={copy.form.emailLabel}
            placeholder={copy.form.emailPlaceholder}
            value={email}
            onValueChange={(next) => {
              setEmail(next);
              setEmailError(undefined);
            }}
            error={emailError}
          />

          <PrivacyNote
            purpose={copy.form.purpose}
            linkLabel={copy.form.privacyPolicyLink}
          />

          <Button
            type="submit"
            variant="outline"
            size="touch"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? copy.form.submitting : copy.inline.submit}
          </Button>

          {mutation.isError ? <RequestError /> : null}
        </form>
      </section>
    </AnnouncedResult>
  );
}
