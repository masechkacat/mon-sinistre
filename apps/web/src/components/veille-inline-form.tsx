'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
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
    mutationFn: ({ email, codeInsee }: { email: string; codeInsee: string }) =>
      subscribeVeille(email, [codeInsee]),
  });
  // The outcome belongs to the commune it was asked for: another commune
  // picked above gets the form again, with the address still typed, since
  // the visitor is the same.
  const asked = mutation.variables?.codeInsee === commune.codeInsee;
  const confirmed = asked && mutation.isSuccess;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmailError = validateEmail(email.trim(), {
      required: copy.form.emailRequiredError,
      invalid: copy.form.emailInvalidError,
    });

    setEmailError(nextEmailError);
    if (nextEmailError) return;

    mutation.mutate({ email, codeInsee: commune.codeInsee });
  };

  return (
    <AnnouncedResult
      result={confirmed ? copy.confirmationSent : undefined}
      announce={confirmed}
      testId="veille-inline-confirmation"
      inline
    >
      <section className="space-y-4">
        <SectionHeading>{copy.inline.heading(commune.name)}</SectionHeading>

        <form
          className="space-y-4"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={asked && mutation.isPending}
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
            disabled={asked && mutation.isPending}
          >
            {asked && mutation.isPending
              ? copy.form.submitting
              : copy.inline.submit}
          </Button>

          {asked && mutation.isError ? <RequestError /> : null}
        </form>
      </section>
    </AnnouncedResult>
  );
}
