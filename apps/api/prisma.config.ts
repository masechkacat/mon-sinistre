// Prisma CLI does not load .env by itself in v7 — this import must stay first.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Connection string is assembled from the DB_* variables shared with
// docker-compose and PrismaService — no separate DATABASE_URL (docs/decisions.md).
const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: `postgresql://${DB_USER}:${encodeURIComponent(DB_PASSWORD ?? '')}@${DB_HOST}:${DB_PORT}/${DB_NAME}`,
  },
});
