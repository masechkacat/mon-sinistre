import type { IsoDate } from '@mon-sinistre/contracts';

function frUtcFormatter(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'UTC' });
}

const longFormatter = frUtcFormatter({ dateStyle: 'long' });

const shortFormatter = frUtcFormatter({
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const partsFormatter = frUtcFormatter({
  weekday: 'long',
  day: 'numeric',
  month: 'short',
});

// The 'Z' suffix pairs with timeZone: 'UTC' above — together they keep the day
// from shifting in any browser timezone.
function utcDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function formatDateFr(date: IsoDate): string {
  return longFormatter.format(utcDate(date));
}

export function formatDateShortFr(date: IsoDate): string {
  return shortFormatter.format(utcDate(date));
}

export interface DateParts {
  month: string;
  day: string;
  weekday: string;
}

export function dateParts(date: IsoDate): DateParts {
  const parts = partsFormatter.formatToParts(utcDate(date));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';

  return { month: part('month'), day: part('day'), weekday: part('weekday') };
}
