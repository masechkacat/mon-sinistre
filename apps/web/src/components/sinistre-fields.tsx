'use client';

import { Field } from '@base-ui/react/field';
import { Fieldset } from '@base-ui/react/fieldset';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import {
  isIsoDate,
  type IsoDate,
  type RisqueCatnat,
} from '@mon-sinistre/contracts';
import { FieldError } from '@/components/field-error';
import {
  inputControlClassName,
  inputFrameClassName,
  inputFrameInvalidClassName,
} from '@/components/ui/input';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';
import { RISQUES } from '@/lib/risques';
import { cn } from '@/lib/utils';

/** The event period of an arrêté: the date is then refined inside it only. */
export interface EventPeriode {
  min: IsoDate;
  max: IsoDate;
}

/** The three fields a dossier starts from, by the name each one answers. */
export interface SinistreFieldErrors {
  commune?: string;
  risque?: string;
  eventDate?: string;
}

export function RisqueField({
  value,
  onValueChange,
  error,
  options = RISQUES,
}: {
  value: RisqueCatnat | null;
  onValueChange: (value: RisqueCatnat | null) => void;
  error?: string;
  options?: readonly RisqueCatnat[];
}) {
  return (
    <Field.Root invalid={Boolean(error)} className="space-y-2">
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
          value={value}
          onValueChange={onValueChange}
          className="mt-2 space-y-3"
        >
          {options.map((option) => {
            const { label, description } = fr.sinistres.risque.options[option];
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
      <FieldError error={error} />
    </Field.Root>
  );
}

export function EventDateField({
  value,
  onValueChange,
  error,
  periode,
}: {
  value: string;
  onValueChange: (value: string) => void;
  error?: string;
  periode?: EventPeriode;
}) {
  return (
    <Field.Root invalid={Boolean(error)} className="space-y-1.5">
      <Field.Label className="block text-sm font-medium">
        {fr.sinistres.nouveau.eventDateLabel}
      </Field.Label>
      {/* The segmented date input prints its own order from the browser's
          locale, not from `<html lang="fr">`: on an English-locale
          browser this field reads mm/dd/yyyy. The 30-day declaration
          deadline runs from whatever lands here, so the order is spelled
          out rather than left to the widget. */}
      <Field.Description className="block text-sm text-muted-foreground">
        {periode
          ? fr.sinistres.nouveau.eventDatePeriodeHint(
              formatDateFr(periode.min),
              formatDateFr(periode.max),
            )
          : fr.sinistres.nouveau.eventDateHint}
      </Field.Description>
      <Field.Control
        type="date"
        value={value}
        min={periode?.min}
        max={periode?.max}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          inputFrameClassName,
          inputControlClassName,
          error && inputFrameInvalidClassName,
        )}
      />
      <FieldError error={error} />
    </Field.Root>
  );
}

/**
 * The French answer about an event date, or undefined when it is usable.
 *
 * `input type="date"` yields either '' or YYYY-MM-DD — but the year is "four
 * or more" digits per the HTML spec, and Chrome lets one be typed, so a
 * five-digit year reaches here and is not an IsoDate. Without this the branded
 * constructor throws inside a submit handler and the button just does nothing.
 */
export function validateEventDate(
  value: string,
  periode?: EventPeriode,
): string | undefined {
  if (!value) return fr.sinistres.nouveau.eventDateRequiredError;
  if (!isIsoDate(value)) return fr.sinistres.nouveau.eventDateInvalidError;
  // `min`/`max` on the control already keep the arrows and the picker inside
  // the period, but a typed-in date lands outside it — and reads as nothing
  // happening when the submit silently refuses it.
  if (periode && (value < periode.min || value > periode.max)) {
    return fr.sinistres.nouveau.eventDatePeriodeError(
      formatDateFr(periode.min),
      formatDateFr(periode.max),
    );
  }
  return undefined;
}

/**
 * The way back a submit owes: the first field in error takes focus, instead of
 * leaving the person at a button with the problem scrolled off above it.
 */
export function focusFirstFieldError(
  form: HTMLFormElement | null,
  errors: SinistreFieldErrors,
) {
  if (!form) return;
  const selector = errors.commune
    ? 'input[role="combobox"]'
    : errors.risque
      ? '[role="radio"]'
      : 'input[type="date"]';
  form.querySelector<HTMLElement>(selector)?.focus();
}
