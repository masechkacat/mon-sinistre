import { defineConfig, devices } from '@playwright/test';
import { testApiBaseUrl, webBaseUrl, webPort } from './tests/support/env';

export default defineConfig({
  testDir: './tests',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: webBaseUrl },
  webServer: {
    // Slow prod build and reuseExistingServer: false are deliberate:
    // docs/research/web-foundation.md, «Тест-раннер и axe-инфраструктура».
    // NEXT_PUBLIC_API_URL below is baked into .next/ by this build (unlike
    // TEST_ROUTES, read at runtime), so a `npm run start` after a test run
    // serves an app pointed at the test address until the next build.
    command: 'npm run build && npm run start',
    port: webPort,
    env: { TEST_ROUTES: '1', NEXT_PUBLIC_API_URL: testApiBaseUrl },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
