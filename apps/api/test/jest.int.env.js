'use strict';

const path = require('node:path');

// Points every integration test at the `${DB_NAME}_test` database created by
// the global setup: loads .env (unit tests never need it, integration tests
// bootstrap the real AppModule with env validation), then rewrites DB_NAME.
// The endsWith guard keeps the suffix idempotent — the worker process is
// reused across test files.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .env is absent — variables come from the environment (e.g. CI).
}

if (!process.env.DB_NAME.endsWith('_test')) {
  process.env.DB_NAME = `${process.env.DB_NAME}_test`;
}
