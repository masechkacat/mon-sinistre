/**
 * Prisma passes the value of a `startsWith`/`endsWith`/`contains` filter
 * straight into a LIKE pattern, so `%` and `_` typed by a user act as wildcards
 * (`q=__` would match every row).
 *
 * One pass over a character class that already contains the backslash, so the
 * escapes this call adds are never re-escaped. Call it exactly once — it is not
 * idempotent. The one escaping rule for the whole API; no second implementation.
 */
export const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, '\\$&');
