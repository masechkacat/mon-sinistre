'use strict';

const { execSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');
const testDbName = require('./test-db-name');

/**
 * Runs once before the integration suite: creates the `${DB_NAME}_test`
 * database on the docker-compose Postgres if it does not exist yet, then
 * applies migrations to it. Overriding DB_NAME is enough to retarget the
 * Prisma CLI — prisma.config.ts builds the connection string from DB_*.
 */
module.exports = async () => {
  try {
    process.loadEnvFile(path.join(__dirname, '..', '.env'));
  } catch {
    // .env is absent — variables come from the environment (e.g. CI).
  }

  const dbName = testDbName(process.env.DB_NAME);

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  try {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (existing.rowCount === 0) {
      // CREATE DATABASE cannot be parameterized; the name is derived from
      // our own DB_NAME, not from user input.
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_NAME: dbName },
    stdio: 'inherit',
  });
};
