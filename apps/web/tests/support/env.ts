import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Deliberately different from the default in src/lib/api/config.ts: set here,
// read by playwright.config.ts (webServer.env) and by tests/api.spec.ts, so a
// single place fixes the expected value.
export const testApiPort = 4001;
export const testApiBaseUrl = `http://localhost:${testApiPort}`;

// The e2e API writes its mail here (playwright.e2e.config.ts) and the e2e spec
// reads the confirmation link back from it — one path for both sides.
export const e2eOutboxDir = join(tmpdir(), 'mon-sinistre-e2e-outbox');
