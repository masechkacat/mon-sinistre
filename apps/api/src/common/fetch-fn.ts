/**
 * The platform `fetch`, taken as a constructor parameter.
 *
 * Every HTTP client of the API is built with one instead of calling the global
 * directly: that is what lets a spec answer with a `Response` of its own, and
 * it is why neither nock nor msw is in the dependency tree. New clients follow
 * the same shape — the parameter comes last and defaults to `globalThis.fetch`,
 * so production code constructs them with nothing extra.
 *
 * Declared once, in `src/common`, because it belongs to no single module: it
 * states one decision about how this API talks HTTP, and a second copy of it is
 * where that decision quietly becomes two.
 */
export type FetchFn = typeof globalThis.fetch;
