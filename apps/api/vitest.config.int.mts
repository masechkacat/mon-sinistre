import { defineConfig } from 'vitest/config';
import { shared } from './vitest.config.mjs';

/**
 * Интеграционные тесты против Postgres из docker-compose (`npm run db:up`)
 * на базе `${DB_NAME}_test`, которую создаёт глобальный setup. Юнит-конфиг
 * их не видит, поэтому `npm test` и pre-commit остаются без Docker.
 */
export default defineConfig({
  ...shared,
  test: {
    ...shared.test,
    include: ['test/**/*.int-spec.ts'],
    setupFiles: [...shared.test.setupFiles, 'test/setup/int.env.ts'],
    globalSetup: ['test/setup/int.global-setup.ts'],
    // Все тесты делят одну базу; если станет медленно — база на воркер
    // через VITEST_POOL_ID, не testcontainers (docs/research/commune-referential.md).
    fileParallelism: false,
  },
});
