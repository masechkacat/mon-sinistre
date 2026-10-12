'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { DossierInput, RegisterInput } from '@mon-sinistre/contracts';
import { AnnouncedResult } from '@/components/announced-result';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { PrivacyNote } from '@/components/privacy-note';
import { RequestError } from '@/components/request-error';
import { EmailField, PasswordField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { useDossierCommune } from '@/lib/api/dossier';
import { communeLabel } from '@/lib/commune-label';
import {
  dossierInput,
  dossierPath,
  type DossierParams,
} from '@/lib/dossier-params';
import { validateEmail } from '@/lib/email-pattern';
import { validatePassword } from '@/lib/password-pattern';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';

/** What is about to be saved, over the form that makes saving possible. */
function DossierResume({ dossier }: { dossier: DossierInput }) {
  // The address carries the commune as a code, which says nothing to the
  // person reading the line. Its name is awaited rather than inserted later:
  // text appended to a line a screen reader has already read goes unannounced
  // (apps/web/CLAUDE.md, доступность). The height is held meanwhile, and a
  // failed lookup leaves the line without the commune.
  const { commune, settled } = useDossierCommune(dossier);

  return (
    <p className="min-h-7 text-lg" data-testid="dossier-resume">
      {settled
        ? fr.dossier.resume([
            fr.sinistres.risque.options[dossier.risque].label,
            ...(commune ? [communeLabel(commune)] : []),
            formatDateFr(dossier.eventDate),
          ])
        : null}
    </p>
  );
}

export function InscriptionForm({ params }: { params: DossierParams }) {
  const dossier = dossierInput(params);

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

    mutation.mutate({ email: trimmedEmail, password, dossier });
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
          {dossier ? <DossierResume dossier={dossier} /> : null}
        </section>

        <form
          className="space-y-6"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={mutation.isPending}
        >
          <EmailField
            label={fr.compte.inscription.emailLabel}
            placeholder={fr.compte.inscription.emailPlaceholder}
            value={email}
            onValueChange={(next) => {
              setEmail(next);
              setEmailError(undefined);
            }}
            error={emailError}
          />

          <PasswordField
            label={fr.compte.inscription.passwordLabel}
            autoComplete="new-password"
            value={password}
            onValueChange={(next) => {
              setPassword(next);
              setPasswordError(undefined);
            }}
            error={passwordError}
          />

          <PrivacyNote
            purpose={fr.compte.inscription.purpose}
            linkLabel={fr.compte.inscription.privacyPolicyLink}
          />

          <Button type="submit" size="touch" disabled={mutation.isPending}>
            {mutation.isPending
              ? fr.compte.inscription.submitting
              : fr.compte.inscription.submit}
          </Button>

          <p className="text-sm">
            {fr.compte.inscription.alreadyRegistered}{' '}
            <Link
              href={dossierPath('/connexion', params)}
              className="underline underline-offset-4"
            >
              {fr.compte.inscription.loginLink}
            </Link>
          </p>

          {mutation.isError ? <RequestError /> : null}
        </form>
      </PageContainer>
    </AnnouncedResult>
  );
}
