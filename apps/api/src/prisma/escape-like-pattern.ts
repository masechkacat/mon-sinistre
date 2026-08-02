/**
 * Escapes the LIKE metacharacters of a value before it goes into a Prisma
 * `startsWith`/`endsWith`/`contains` filter.
 *
 * Prisma passes such a value straight into a LIKE pattern, so `%` and `_`
 * typed by a user act as wildcards (`q=__` would match every row). Postgres
 * reads a backslash as the default LIKE escape character and the pattern
 * travels as a bind parameter, so escaping here keeps the query typed — no
 * `$queryRaw` needed.
 *
 * One pass over a character class that already contains the backslash: the
 * escapes added by this call are therefore never re-escaped. A sequential
 * `replace` per metacharacter would have to treat the backslash first, and
 * getting that order wrong is exactly the bug this shape avoids.
 *
 * Lives here rather than next to a single query on purpose: this is the one
 * escaping rule for the whole API, and a second implementation would drift.
 */
export const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, '\\$&');
