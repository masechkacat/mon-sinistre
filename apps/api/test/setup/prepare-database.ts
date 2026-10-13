import { execSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Makes `dbName` exist on the docker-compose Postgres and migrates it. Shared
 * by the integration global setup and the e2e seed. CREATE DATABASE goes
 * through the database DB_NAME names, which must already exist. Overriding
 * DB_NAME for the migration is enough to retarget the Prisma CLI —
 * prisma.config.ts builds the connection string from DB_*.
 */
export default async function prepareDatabase(dbName: string): Promise<void> {
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
    cwd: path.join(import.meta.dirname, '..', '..'),
    env: { ...process.env, DB_NAME: dbName },
    stdio: 'inherit',
  });
}
