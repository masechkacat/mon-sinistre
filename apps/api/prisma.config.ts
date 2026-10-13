import { defineConfig } from 'prisma/config';
import { databaseUrlFromEnv } from './src/prisma/database-url-from-env.js';
import { loadApiEnv } from './src/prisma/load-env.js';

// The Prisma 7 CLI does not load .env by itself.
loadApiEnv();

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
