/** Shared by every feature that measures a window in days against
 * `Date.now()` (veille's confirm/change deadlines and form-mail counter,
 * account confirmation) — one definition, so a day is the same number of
 * milliseconds everywhere. */
export const DAY_MS = 24 * 60 * 60 * 1000;

export const HOUR_MS = DAY_MS / 24;

/** `now + ms` as a `Date` — the one place "add a duration to now" is
 * spelled out; `addDays`/`addHours` below are its only callers, so a
 * deadline never disagrees with `Date.now()` in two different ways. */
const addMs = (ms: number): Date => new Date(Date.now() + ms);

/** Called wherever a deadline is a fixed number of days from creation
 * (veille confirm/change expiry, account confirm expiry). */
export const addDays = (days: number): Date => addMs(days * DAY_MS);

/** Same shape as `addDays`, for a window measured in hours (password reset
 * expiry, `PASSWORD_RESET_TTL_HOURS`). */
export const addHours = (hours: number): Date => addMs(hours * HOUR_MS);
