'use strict';

const path = require('node:path');
const testDbName = require('./test-db-name');

// Points every integration test at the `${DB_NAME}_test` database created by
// the global setup: loads .env (unit tests never need it, integration tests
// bootstrap the real AppModule with env validation), then rewrites DB_NAME
// via the shared helper — the same one the global setup uses.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .env is absent — variables come from the environment (e.g. CI).
}

process.env.DB_NAME = testDbName(process.env.DB_NAME);
