// Deliberately different from the default in src/lib/api/config.ts: set here,
// read by playwright.config.ts (webServer.env) and by tests/api.spec.ts, so a
// single place fixes the expected value.
export const testApiPort = 4001;
export const testApiBaseUrl = `http://localhost:${testApiPort}`;
