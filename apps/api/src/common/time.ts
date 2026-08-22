/** Shared by every feature that measures a window in days against
 * `Date.now()` (veille's confirm/change deadlines and form-mail counter,
 * account confirmation) — one definition, so a day is the same number of
 * milliseconds everywhere. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** `now + days` as a `Date` — the one place "add N days to now" is spelled
 * out, called wherever a deadline is a fixed number of days from creation
 * (veille confirm/change expiry, account confirm expiry). */
export const addDays = (days: number): Date =>
  new Date(Date.now() + days * DAY_MS);
