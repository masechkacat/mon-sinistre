import { loadApiEnv } from './load-env.js';
import testDbName from './test-db-name.js';

loadApiEnv();
process.env.DB_NAME = testDbName(process.env.DB_NAME);
