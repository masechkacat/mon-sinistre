import { defineConfig, devices } from '@playwright/test';
import { testApiBaseUrl } from './tests/env';

export default defineConfig({
  testDir: './tests',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    // Slow prod build and reuseExistingServer: false are deliberate:
    // docs/research/web-foundation.md, «Тест-раннер и axe-инфраструктура».
    command: 'npm run build && npm run start',
    port: 3000,
    env: { TEST_ROUTES: '1', NEXT_PUBLIC_API_URL: testApiBaseUrl },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
