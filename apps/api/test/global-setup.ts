import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Creates the `${DB_NAME}_test` database on the docker-compose Postgres (if
 * missing) and brings its schema up to date with `prisma migrate deploy`.
 * prisma.config.ts assembles the url from DB_*, so overriding DB_NAME alone
 * switches the CLI to the test database.
 */
export default async function globalSetup(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env — variables come from the environment itself (CI).
  }

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const testDbName = `${DB_NAME}_test`;

  const client = new Client({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });
  await client.connect();
  try {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [testDbName],
    );
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${testDbName}"`);
    }
  } finally {
    await client.end();
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DB_NAME: testDbName },
    stdio: 'inherit',
  });
}
