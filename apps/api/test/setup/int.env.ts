import { loadApiEnv } from './load-env.js';
import testDbName from './test-db-name.js';

// Points every integration test at the `${DB_NAME}_test` database created by
// the global setup — the same helper derives the name on both sides.
loadApiEnv();
process.env.DB_NAME = testDbName(process.env.DB_NAME);
