/**
 * Builds the Postgres connection string from the individual DB_* variables.
 * There is deliberately no DATABASE_URL variable: docker-compose, the Prisma
 * CLI (prisma.config.ts) and the runtime (PrismaService) all derive the same
 * URL from DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME, so they are guaranteed
 * to point at the same database.
 */
export function buildDatabaseUrl(vars: {
  host: string;
  port: string | number;
  user: string;
  password: string;
  database: string;
}): string {
  const user = encodeURIComponent(vars.user);
  const password = encodeURIComponent(vars.password);
  return `postgresql://${user}:${password}@${vars.host}:${vars.port}/${vars.database}`;
}
