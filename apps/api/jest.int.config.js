/**
 * Integration tests against the real Postgres from docker-compose
 * (`npm run db:up`), on a separate `${DB_NAME}_test` database — decision in
 * ../../docs/research/commune-referential.md. Mirrors the unit config from
 * package.json; only the suffix differs (`*.int-spec.ts`), so the unit run
 * and the pre-commit hook stay fast and Docker-free.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  // globalSetup runs in its own process: env set there does not reach the
  // workers, hence the extra setup file that re-points DB_NAME per worker.
  globalSetup: '<rootDir>/../test/global-setup.ts',
  setupFiles: ['reflect-metadata', '<rootDir>/../test/int-env.ts'],
  testRegex: '.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@mon-sinistre/contracts$': '<rootDir>/../../../packages/contracts/src',
    '^src/(.*)$': '<rootDir>/$1',
  },
  testEnvironment: 'node',
  // The suites share one database — parallel workers would race on TRUNCATE.
  maxWorkers: 1,
};
