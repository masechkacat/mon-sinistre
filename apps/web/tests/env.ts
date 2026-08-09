// Adresse distincte du défaut de src/lib/api/config.ts (localhost:3001) :
// posée ici, lue par playwright.config.ts (webServer.env) et par
// tests/api.spec.ts, pour qu'un seul endroit fixe la valeur attendue.
export const testApiBaseUrl = 'http://localhost:4001';
