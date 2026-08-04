/**
 * The platform `fetch`, taken as a constructor parameter (last, defaulting to
 * `globalThis.fetch`). Every HTTP client of the API is built with one, which is
 * why neither nock nor msw is in the dependency tree.
 */
export type FetchFn = typeof globalThis.fetch;
