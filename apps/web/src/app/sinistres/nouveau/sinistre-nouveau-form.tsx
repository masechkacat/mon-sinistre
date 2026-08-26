'use client';

import { Field } from '@base-ui/react/field';
import { Fieldset } from '@base-ui/react/fieldset';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { useMutation } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { RisqueCatnat, toIsoDate, type Commune } from '@mon-sinistre/contracts';
import { CommuneSelect } from '@/components/commune-select';
import { FieldError } from '@/components/field-error';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import {
  inputFrameClassName,
  inputFrameInvalidClassName,
} from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { createSinistre } from '@/lib/api/sinistres';
import { useSessionGuard } from '@/lib/api/use-session-guard';
import { cn } from '@/lib/utils';
import { fr } from '@/i18n/fr';

const RISQUES = Object.values(RisqueCatnat);

export function SinistreNouveauForm() {
  const status = useSessionGuard();
  const router = useRouter();
  const [commune, setCommune] = useState<Commune | null>(null);
  const [risque, setRisque] = useState<RisqueCatnat | null>(null);
  const [eventDate, setEventDate] = useState('');
  const [communeError, setCommuneError] = useState<string>();
  const [risqueError, setRisqueError] = useState<string>();
  const [eventDateError, setEventDateError] = useState<string>();

  const mutation = useMutation({
    mutationFn: createSinistre,
    onSuccess: (sinistre) => {
      // The timeline screen (docs/plan/sinistre-plan.md, Фаза 7) does not
      // exist yet, so typedRoutes cannot verify this path — same escape
      // hatch as tests/support/pages.ts uses for a URL it cannot statically
      // know either. Runtime 404 until that phase ships is expected.
      router.push(`/sinistres/${sinistre.id}` as Route);
    },
  });

  // The date's own future-date rule lives once, in the API's DTO validator
  // (IsNotFutureIsoDate) — this reads its French answer back rather than
  // re-checking the rule here (root CLAUDE.md, «не дублировать»). Gated on
  // `detailIsFieldError`: the only DTO validator this form can still trip is
  // the date's (commune and risque are already guaranteed valid by the
  // pickers above), but `SinistresService.create` can also 400 with an
  // unrelated business error (e.g. the selected commune stopped being
  // current between search and submit) — that one must not be mislabelled
  // as the date's.
  const apiEventDateError =
    mutation.error instanceof ApiError &&
    mutation.error.status === 400 &&
    mutation.error.detailIsFieldError
      ? mutation.error.detail
      : undefined;
  const eventDateFieldError = eventDateError ?? apiEventDateError;
  const requestFailed = mutation.isError && !apiEventDateError;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextCommuneError = commune
      ? undefined
      : fr.sinistres.nouveau.communeRequiredError;
    const nextRisqueError = risque
      ? undefined
      : fr.sinistres.risque.requiredError;
    const nextEventDateError = eventDate
      ? undefined
      : fr.sinistres.nouveau.eventDateRequiredError;

    setCommuneError(nextCommuneError);
    setRisqueError(nextRisqueError);
    setEventDateError(nextEventDateError);
    if (!commune || !risque || nextEventDateError) return;

    mutation.mutate({
      codeInsee: commune.codeInsee,
      risque,
      eventDate: toIsoDate(eventDate),
    });
  };

  if (status === 'checking') {
    return (
      <PageContainer className="space-y-8">
        <PageTitle>{fr.sinistres.nouveau.page.title}</PageTitle>
        <p
          data-testid="session-status"
          className="text-lg text-muted-foreground"
        >
          {fr.session.checking}
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-8">
      <section className="space-y-4">
        <PageTitle>{fr.sinistres.nouveau.page.title}</PageTitle>
        <p className="text-lg text-muted-foreground">
          {fr.sinistres.nouveau.lead}
        </p>
      </section>

      <form
        className="space-y-6"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={mutation.isPending}
      >
        <CommuneSelect
          value={commune}
          onValueChange={(next) => {
            setCommune(next);
            if (next) setCommuneError(undefined);
          }}
          label={fr.sinistres.nouveau.communeLabel}
          error={communeError}
        />

        <Field.Root invalid={Boolean(risqueError)} className="space-y-2">
          {/* Fieldset, not Field.Label: a Field.Label here would also become
              every individual Radio.Root's accessible name (they read the
              same LabelableContext the group does), replacing "Inondation"
              with the whole question on each option. Fieldset.Legend feeds
              only RadioGroup's own aria-labelledby. */}
          <Fieldset.Root>
            <Fieldset.Legend className="block text-sm font-medium">
              {fr.sinistres.risque.label}
            </Fieldset.Legend>
            <RadioGroup
              value={risque}
              onValueChange={(next) => {
                setRisque(next);
                setRisqueError(undefined);
              }}
              className="mt-2 space-y-3"
            >
              {RISQUES.map((option) => {
                const { label, description } =
                  fr.sinistres.risque.options[option];
                const labelId = `risque-${option}-label`;
                const descriptionId = `risque-${option}-description`;
                return (
                  // A radio nested in a RadioGroup falls back to *the
                  // group's own* label when it has no name of its own
                  // (RadioRoot reads the same ambient labelId the group
                  // does) — every option would announce as "Quel est le
                  // risque…" instead of its own name. An explicit
                  // aria-labelledby, pointing at this option's own span,
                  // takes priority over that fallback; aria-describedby
                  // keeps the explanation as supplementary text rather than
                  // folding it into the name.
                  <label
                    key={option}
                    className="flex cursor-default items-start gap-2.5"
                  >
                    <Radio.Root
                      value={option}
                      aria-labelledby={labelId}
                      aria-describedby={descriptionId}
                      className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background',
                        'data-[checked]:border-primary focus-visible:ring-3 focus-visible:ring-ring/50 outline-none',
                      )}
                    >
                      <Radio.Indicator className="size-2 rounded-full bg-primary" />
                    </Radio.Root>
                    <span>
                      <span id={labelId} className="block text-sm font-medium">
                        {label}
                      </span>
                      <span
                        id={descriptionId}
                        className="block text-sm text-muted-foreground"
                      >
                        {description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          </Fieldset.Root>
          <FieldError error={risqueError} />
        </Field.Root>

        <Field.Root
          invalid={Boolean(eventDateFieldError)}
          className="space-y-1.5"
        >
          <Field.Label className="block text-sm font-medium">
            {fr.sinistres.nouveau.eventDateLabel}
          </Field.Label>
          <Field.Control
            type="date"
            value={eventDate}
            onChange={(event) => {
              setEventDate(event.target.value);
              setEventDateError(undefined);
              if (mutation.isError) mutation.reset();
            }}
            className={cn(
              inputFrameClassName,
              'px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50',
              eventDateFieldError && inputFrameInvalidClassName,
            )}
          />
          <FieldError error={eventDateFieldError} />
        </Field.Root>

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? fr.sinistres.nouveau.submitting
            : fr.sinistres.nouveau.submit}
        </Button>

        {requestFailed ? <RequestError /> : null}
      </form>
    </PageContainer>
  );
}
