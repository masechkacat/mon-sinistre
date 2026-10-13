import { defineConfig } from 'vitest/config';
import { shared } from './vitest.config.mjs';

export default defineConfig({
  ...shared,
  test: {
    ...shared.test,
    include: ['test/**/*.int-spec.ts'],
    setupFiles: [...shared.test.setupFiles, 'test/setup/int.env.ts'],
    globalSetup: ['test/setup/int.global-setup.ts'],
    fileParallelism: false,
  },
});
