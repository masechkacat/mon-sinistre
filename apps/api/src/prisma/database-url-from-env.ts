import { buildDatabaseUrl } from './database-url';

/**
 * For the three callers that run outside Nest: the Prisma CLI config, the seed
 * and the integration-test client. Inside Nest the five values come from the
 * validated ConfigService, and reaching for process.env would step around that
 * validation.
 */

/** The message names the variable and nothing else — several of the five are
 * secrets, and this text ends up in a terminal and a CI log. */
const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  // Empty counts as unset: an empty DB_PASSWORD or DB_NAME builds a URL that is
  // syntactically fine and fails at connection time, naming a database nobody
  // meant to reach.
  if (!value) {
    throw new Error(
      `${name} is not set — create apps/api/.env (cp .env.example .env) or provide the DB_* variables in the environment.`,
    );
  }
  return value;
};

export const databaseUrlFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): string =>
  buildDatabaseUrl({
    host: required(env, 'DB_HOST'),
    port: required(env, 'DB_PORT'),
    user: required(env, 'DB_USER'),
    password: required(env, 'DB_PASSWORD'),
    database: required(env, 'DB_NAME'),
  });
