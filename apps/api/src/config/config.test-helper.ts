import type { ConfigService } from '@nestjs/config';

import { validateEnv, type EnvironmentVariables } from './env.validation';

/**
 * The one ConfigService stub of the unit specs. The base is the real schema's
 * own output, so a default added to the schema reaches every spec.
 *
 * Overrides are applied raw and deliberately not validated: a spec's subject is
 * often a configuration that must not be accepted, and validating them would
 * make those states unreachable. An override of `undefined` means "not set".
 */
const VALID_ENV: Record<string, string> = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'mon_sinistre',
  DB_PASSWORD: 'secret',
  DB_NAME: 'mon_sinistre',
  FRONTEND_URL: 'http://localhost:3000',
  MAIL_FROM: 'no-reply@mon-sinistre.test',
  JWT_SECRET: 'x'.repeat(48),
  JWT_REFRESH_SECRET: 'x'.repeat(48),
  COOKIE_SECRET: 'x'.repeat(48),
};

/** Every variable the schema declares, defaults included. Computed once. */
const BASE: Record<string, unknown> = { ...validateEnv(VALID_ENV) };

export const configFor = (
  overrides: Record<string, string | undefined> = {},
): ConfigService<EnvironmentVariables, true> => {
  const values: Record<string, unknown> = { ...BASE, ...overrides };

  return {
    get: (key: string): unknown => values[key],
    // The failure of the real ConfigService: the name of the missing key and
    // nothing of its value, which is a secret for several of them.
    getOrThrow: (key: string): unknown => {
      if (values[key] === undefined) {
        throw new Error(`Configuration key "${key}" does not exist`);
      }
      return values[key];
    },
  } as unknown as ConfigService<EnvironmentVariables, true>;
};
