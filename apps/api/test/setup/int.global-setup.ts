import { loadApiEnv } from './load-env';
import prepareDatabase from './prepare-database';
import testDbName from './test-db-name';

/** Runs once before the integration suite: prepares `${DB_NAME}_test`. */
export async function setup(): Promise<void> {
  loadApiEnv();
  await prepareDatabase(testDbName(process.env.DB_NAME));
}
