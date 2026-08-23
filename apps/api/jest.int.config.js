/**
 * Integration tests against the real Postgres from docker-compose
 * (`npm run db:up`), on a separate `${DB_NAME}_test` database created by the
 * global setup. Specs live in `test/integration/<module>/` as `*.int-spec.ts`;
 * the unit config in package.json has rootDir `src`, so `npm test` and the
 * pre-commit hook never see them and stay fast and Docker-free.
 *
 * maxWorkers: 1 is mandatory while all tests share one database; if the run
 * ever gets slow, switch to a database per worker via JEST_WORKER_ID — not to
 * testcontainers (docs/research/commune-referential.md).
 *
 * The `test:int` script runs Jest under `--experimental-vm-modules`, without
 * which no suite that boots the app can run at all: `@fastify/cookie`
 * registers via `await import('cookie')`, and Jest throws on any dynamic
 * `import()` inside its sandbox unless that flag is set. Node outside Jest
 * needs nothing (`main.ts` registers the same plugin unmodified).
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  setupFiles: ['reflect-metadata', '<rootDir>/test/setup/jest.int.env.js'],
  testRegex: '.*\\.int-spec\\.ts$',
  // As in the unit config: a spy on a global (fetch, Logger) is undone after
  // the test that set it, whatever that test did afterwards. A spy surviving
  // into the next suite is a failure nobody reads as one.
  restoreMocks: true,
  // Only .ts: the setup files in test/setup/ are plain CommonJS run by Node
  // itself, ts-jest warns if asked to compile them.
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleNameMapper: {
    '^@mon-sinistre/contracts$': '<rootDir>/../../packages/contracts/src',
    '^src/(.*)$': '<rootDir>/src/$1',
    '^test/(.*)$': '<rootDir>/test/$1',
  },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/setup/jest.int.global-setup.js',
  // rootDir is the app, not src/ — otherwise the specs under test/ fall
  // outside it. dist/ then has to be excluded by hand: it holds a compiled
  // copy of every module, and Jest's haste map reports each as a duplicate.
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  maxWorkers: 1,
};
