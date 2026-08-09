// The only read of NEXT_PUBLIC_API_URL on the client —
// docs/research/web-foundation.md, «Слой обращения к API». NEXT_PUBLIC_* is
// inlined into the bundle at build time, not at startup: the production
// address is therefore decided by the build.
// The trailing slash is trimmed because apiFetch concatenates the path
// directly, and `http://host//health` is a 404 on the API router.
// `||`, not `??`: a variable declared but left empty (a blank line in
// .env.local, an unset CI variable interpolated as '') would otherwise pass,
// and every request would resolve against the web app's own origin.
export const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');
