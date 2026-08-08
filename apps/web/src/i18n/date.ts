import type { IsoDate } from '@mon-sinistre/contracts';

const formatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

// timeZone: 'UTC' is paired with the 'Z' suffix: IsoDate carries no time, and
// the UTC round-trip prevents a one-day shift in any browser timezone.
export function formatDateFr(date: IsoDate): string {
  return formatter.format(new Date(`${date}T00:00:00Z`));
}
