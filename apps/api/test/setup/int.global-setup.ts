import { loadApiEnv } from '../../src/prisma/load-env.js';
import prepareDatabase from './prepare-database.js';
import testDbName from './test-db-name.js';

/** Runs once before the integration suite: prepares `${DB_NAME}_test`. */
export async function setup(): Promise<void> {
  loadApiEnv();
  await prepareDatabase(testDbName(process.env.DB_NAME));
}
