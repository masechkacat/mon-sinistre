import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { testApiBaseUrl, testApiPort } from './tests/support/env';

const repoRoot = resolve(__dirname, '../..');

export default defineConfig({
  testDir: './e2e',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://localhost:3000' },
  // Порядок важен: web собирается с NEXT_PUBLIC_API_URL на уже поднятый API.
  webServer: [
    {
      command: 'npm run start --workspace @mon-sinistre/api',
      cwd: repoRoot,
      port: testApiPort,
      env: {
        PORT: String(testApiPort),
        MAIL_OUTBOX_DIR: join(tmpdir(), 'mon-sinistre-e2e-outbox'),
      },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'npm run build && npm run start',
      port: 3000,
      env: { NEXT_PUBLIC_API_URL: testApiBaseUrl },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
