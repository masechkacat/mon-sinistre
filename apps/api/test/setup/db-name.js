'use strict';

/**
 * Shared by the test and e2e database names. The endsWith guard keeps the
 * suffix idempotent: the worker process is reused across test files, and
 * DB_NAME may already carry the suffix in CI.
 */
module.exports = function suffixedDbName(baseName, suffix) {
  if (!baseName) {
    throw new Error('DB_NAME is not set');
  }
  return baseName.endsWith(suffix) ? baseName : `${baseName}${suffix}`;
};
