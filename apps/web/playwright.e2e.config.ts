import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig, devices } from '@playwright/test';
import e2eDbName from '../api/test/setup/e2e-db-name';
import {
  e2eOutboxDir,
  testApiBaseUrl,
  testApiPort,
  webBaseUrl,
  webPort,
} from './tests/support/env';

const repoRoot = resolve(__dirname, '../..');
const apiDir = resolve(repoRoot, 'apps/api');

// Read, not loaded into process.env: apps/api/.env also carries PORT=3001,
// which `next start` below would inherit.
const apiDotEnvDbName = (): string | undefined => {
  try {
    return parseEnv(readFileSync(resolve(apiDir, '.env'), 'utf8')).DB_NAME;
  } catch {
    return undefined;
  }
};
const e2eDatabase = e2eDbName(process.env.DB_NAME ?? apiDotEnvDbName());

export default defineConfig({
  testDir: './e2e',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: webBaseUrl },
  // Порядок важен: web собирается с NEXT_PUBLIC_API_URL на уже поднятый API.
  webServer: [
    {
      // Outbox emptied first, so the spec's poll reads only this run's mail.
      // The seed keeps the base DB_NAME: it creates `_e2e` from there.
      command: `rm -rf "${e2eOutboxDir}" && npx ts-node -r tsconfig-paths/register scripts/e2e-seed.ts && DB_NAME=${e2eDatabase} npm run start`,
      cwd: apiDir,
      port: testApiPort,
      env: {
        PORT: String(testApiPort),
        // CORS origin (credentials: true) and the mail links both follow it —
        // pinned to the web server below, not to whatever .env says.
        FRONTEND_URL: webBaseUrl,
        MAIL_TRANSPORT: 'file',
        MAIL_OUTBOX_DIR: e2eOutboxDir,
      },
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command: 'npm run build && npm run start',
      port: webPort,
      env: { NEXT_PUBLIC_API_URL: testApiBaseUrl },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
