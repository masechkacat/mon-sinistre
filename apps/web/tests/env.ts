// Deliberately different from the default in src/lib/api/config.ts: set here,
// read by playwright.config.ts (webServer.env) and by tests/api.spec.ts, so a
// single place fixes the expected value.
export const testApiBaseUrl = 'http://localhost:4001';
