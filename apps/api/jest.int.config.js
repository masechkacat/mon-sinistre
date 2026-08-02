/**
 * Integration tests against the real Postgres from docker-compose
 * (`npm run db:up`), on a separate `${DB_NAME}_test` database created by the
 * global setup. Specs live next to the code as `*.int-spec.ts`; the unit
 * config in package.json does not match that suffix, so `npm test` and the
 * pre-commit hook stay fast and Docker-free.
 *
 * maxWorkers: 1 is mandatory while all tests share one database; if the run
 * ever gets slow, switch to a database per worker via JEST_WORKER_ID — not to
 * testcontainers (docs/research/commune-referential.md).
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  setupFiles: ['reflect-metadata', '<rootDir>/../test/jest.int.env.js'],
  testRegex: '.*\\.int-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleNameMapper: {
    '^@mon-sinistre/contracts$': '<rootDir>/../../../packages/contracts/src',
    '^src/(.*)$': '<rootDir>/$1',
  },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/../test/jest.int.global-setup.js',
  maxWorkers: 1,
};
