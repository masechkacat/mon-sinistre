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
  migrations: {
    // npm run seed → one-off idempotent referential import (communes COG).
    // tsconfig-paths/register keeps the `src/...` path alias working at
    // runtime: plain ts-node would only survive type-level src imports
    // (tsc elides them), and any value-level one would die MODULE_NOT_FOUND.
    seed: 'ts-node -r tsconfig-paths/register prisma/seed.ts',
  },
  datasource: {
    url: buildDatabaseUrl({
      // All five are required, exactly like the runtime's getOrThrow — the CLI
      // must never silently fall back to a default host while the app refuses
      // to start on the same .env.
      host: required('DB_HOST'),
      port: required('DB_PORT'),
      user: required('DB_USER'),
      password: required('DB_PASSWORD'),
      database: required('DB_NAME'),
    }),
  },
});
