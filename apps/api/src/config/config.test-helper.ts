import type { ConfigService } from '@nestjs/config';

import { validateEnv, type EnvironmentVariables } from './env.validation';

/**
 * The one ConfigService stub of the unit specs.
 *
 * Four specs used to build their own, and the four drifted: when the schema
 * started supplying a default, three of them still described an application
 * that could no longer exist, and the divergence surfaced as a test handing a
 * transport nothing at all. The base here is not a hand-written record but the
 * real schema's own output, so a default added to the schema reaches every spec
 * without anybody remembering to copy it.
 *
 * Overrides are applied raw, on top, and deliberately not validated: a spec's
 * whole subject is often a configuration that must not be accepted — a sender
 * address with a line break, a provider selected without its credentials.
 * Validating them would make those states unreachable and delete the tests.
 *
 * An override of `undefined` means "this variable is not set", which is how a
 * spec asks what happens without it.
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
