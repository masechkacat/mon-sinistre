import { IsoDate, toIsoDate } from '@mon-sinistre/contracts';

const FRENCH_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Converts a JORF annexe date cell (`DD/MM/YYYY`) to `IsoDate`. */
export function parseFrenchDate(value: string): IsoDate {
  const match = FRENCH_DATE_PATTERN.exec(value.trim());
  if (!match) {
    throw new RangeError(`Not a DD/MM/YYYY date: "${value}"`);
  }
  const [, day, month, year] = match;
  return toIsoDate(`${year}-${month}-${day}`);
}

/** The inverse of {@link parseFrenchDate} — how a domain date is shown to a
 * French reader (mail bodies), matching the annexe cells it originally came
 * from. */
export function formatFrenchDate(date: IsoDate): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
