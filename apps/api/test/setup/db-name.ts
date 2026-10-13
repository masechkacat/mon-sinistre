/**
 * The endsWith guard keeps the suffix idempotent: the worker process is
 * reused across test files, and DB_NAME may already carry the suffix in CI.
 */
export default function suffixedDbName(
  baseName: string | undefined,
  suffix: string,
): string {
  if (!baseName) {
    throw new Error(
      'DB_NAME is not set — create apps/api/.env (cp .env.example .env) or provide the DB_* variables in the environment.',
    );
  }
  return baseName.endsWith(suffix) ? baseName : `${baseName}${suffix}`;
}
