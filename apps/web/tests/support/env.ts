import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Deliberately different from the default in src/lib/api/config.ts: set here,
// read by both Playwright configs (webServer.env) and by tests/app/api.spec.ts, so
// a single place fixes the expected value.
export const testApiPort = 4001;
export const testApiBaseUrl = `http://localhost:${testApiPort}`;

export const webPort = 3000;
export const webBaseUrl = `http://localhost:${webPort}`;

// The e2e API writes its mail here (playwright.e2e.config.ts) and the e2e spec
// reads the confirmation token back from it — one path for both sides.
export const e2eOutboxDir = join(tmpdir(), 'mon-sinistre-e2e-outbox');
