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

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: buildDatabaseUrl({
      host: process.env.DB_HOST ?? 'localhost',
      port: process.env.DB_PORT ?? 5432,
      user: process.env.DB_USER ?? '',
      password: process.env.DB_PASSWORD ?? '',
      database: process.env.DB_NAME ?? '',
    }),
  },
});
