/**
 * Runs in every jest worker before the suites: loads .env (if present) and
 * points DB_NAME at the test database prepared by global-setup.ts, so
 * PrismaService built through ConfigService connects to `${DB_NAME}_test`.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env — variables come from the environment itself (CI).
}

process.env.DB_NAME = `${process.env.DB_NAME}_test`;
