'use strict';

/**
 * Single source of the integration-test database name. Both the global setup
 * (which creates and migrates the database) and the per-worker env file
 * (which points PrismaService at it) must derive the exact same name —
 * otherwise the setup migrates one database and the tests connect to another.
 * The endsWith guard keeps the suffix idempotent: the worker process is
 * reused across test files, and DB_NAME may already carry the suffix in CI.
 */
module.exports = function testDbName(baseName) {
  if (!baseName) {
    throw new Error(
      'DB_NAME is not set — create apps/api/.env (cp .env.example .env) or provide the DB_* variables in the environment.',
    );
  }
  return baseName.endsWith('_test') ? baseName : `${baseName}_test`;
};
