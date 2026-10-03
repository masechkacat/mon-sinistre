'use strict';

const path = require('node:path');
const prepareDatabase = require('./prepare-database');
const testDbName = require('./test-db-name');

/** Runs once before the integration suite: prepares `${DB_NAME}_test`. */
module.exports = async () => {
  try {
    process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));
  } catch {
    // .env is absent — variables come from the environment (e.g. CI).
  }

  await prepareDatabase(testDbName(process.env.DB_NAME));
};
