/**
 * A string rather than `Date` keeps domain dates free of timezone shifts: a
 * deadline is the same day everywhere.
 */

declare const isoDateBrand: unique symbol;

/**
 * Branded, so an arbitrary `string` does not type-check here. Construct with
 * {@link toIsoDate} or narrow with {@link isIsoDate}; the brand is erased at
 * runtime.
 */
export type IsoDate = string & { readonly [isoDateBrand]: 'IsoDate' };

/** Timestamp with a time component, as ISO 8601. */
export type IsoDateTime = string;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True when `value` is a real calendar date in `YYYY-MM-DD` form (leap years included). */
export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  // Round-tripping through UTC rejects dates that merely look valid, such as
  // 2026-02-30 (parsed as March 2) or a 13th month (Invalid Date).
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** Validates and brands a `YYYY-MM-DD` string; throws on anything else. */
export function toIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) {
    throw new RangeError(`Not a valid YYYY-MM-DD calendar date: ${value}`);
  }
  return value;
}
