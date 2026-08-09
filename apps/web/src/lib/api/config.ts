// Seule lecture de NEXT_PUBLIC_API_URL du client — docs/research/web-foundation.md,
// « Слой обращения к API ». NEXT_PUBLIC_* est figé dans le bundle au build,
// pas au démarrage : l'adresse de prod se règle donc lors du build.
export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
