import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Общее для unit и int: алиасы tsconfig и contracts из исходников. */
export const shared = {
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@mon-sinistre/contracts': fileURLToPath(
        new URL('../../packages/contracts/src', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    setupFiles: ['reflect-metadata'],
    restoreMocks: true,
    // Порядок хуков как у Jest: afterEach в порядке объявления, не в обратном.
    sequence: { hooks: 'list' as const },
  },
};

export default defineConfig({
  ...shared,
  test: { ...shared.test, include: ['src/**/*.spec.ts'] },
});
