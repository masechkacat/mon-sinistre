import { defineConfig } from 'prisma/config';
import { databaseUrlFromEnv } from './src/prisma/database-url-from-env.js';

// The Prisma 7 CLI does not load .env by itself. Node ≥ 24 can do it natively;
// the catch covers environments without a .env file (e.g. CI), where the
// variables come from the process environment instead.
try {
  process.loadEnvFile();
} catch {
  // .env is absent — variables are expected in the environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // npm run seed → one-off idempotent referential import (communes COG).
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // All five are required, exactly like the runtime's getOrThrow — the CLI
    // must never silently fall back to a default host while the application
    // refuses to start on the same .env.
    url: databaseUrlFromEnv(),
  },
});
