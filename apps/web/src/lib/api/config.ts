// The only read of NEXT_PUBLIC_API_URL — docs/research/web-foundation.md,
// «Слой обращения к API». NEXT_PUBLIC_* is inlined at build time, not at
// startup: the production address is decided by the build, and one value
// serves both callers — the browser, and the one-click unsubscribe route
// handler, which dials the API from the web server itself.
// The trailing slash is trimmed because apiFetch concatenates the path
// directly, and `http://host//health` is a 404 on the API router.
// `||`, not `??`: a variable declared but left empty (a blank line in
// .env.local, an unset CI variable interpolated as '') would otherwise pass,
// and every request would resolve against the web app's own origin.
export const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');
