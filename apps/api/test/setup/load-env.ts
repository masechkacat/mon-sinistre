import path from 'node:path';

/** apps/api/.env, if present — otherwise the variables come from the environment (CI). */
export function loadApiEnv(): void {
  try {
    process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));
  } catch {
    // .env is absent.
  }
}
