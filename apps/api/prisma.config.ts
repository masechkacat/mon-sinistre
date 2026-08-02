import { defineConfig } from 'prisma/config';
import { buildDatabaseUrl } from './src/prisma/database-url';

// The Prisma 7 CLI does not load .env by itself. Node ≥ 24 can do it natively;
// the catch covers environments without a .env file (e.g. CI), where the
// variables come from the process environment instead.
try {
  process.loadEnvFile();
} catch {
  // .env is absent — variables are expected in the environment.
}

// Fail fast with the variable's name instead of letting the CLI hit the
// database with a silently-built invalid URL (the runtime counterpart,
// PrismaService, gets the same behaviour from ConfigService.getOrThrow).
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — create apps/api/.env (cp .env.example .env) or provide the DB_* variables in the environment.`,
    );
  }
  return value;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: buildDatabaseUrl({
      host: process.env.DB_HOST ?? 'localhost',
      port: process.env.DB_PORT ?? 5432,
      user: required('DB_USER'),
      password: required('DB_PASSWORD'),
      database: required('DB_NAME'),
    }),
  },
});
