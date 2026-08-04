import { buildDatabaseUrl } from './database-url';

/**
 * The connection string built from the five DB_* variables read straight out
 * of the process environment — for the three callers that run outside Nest:
 * the Prisma CLI config, the seed and the integration-test client.
 *
 * Inside Nest nothing calls this: there the five values come from the
 * validated `ConfigService`, and reaching for `process.env` would step around
 * that validation (`../../CLAUDE.md`). The two paths still meet at
 * `buildDatabaseUrl`, which is what keeps the CLI, the tests and the
 * application on the same database.
 *
 * The three callers each used to carry their own copy of "read it, refuse if
 * it is empty" — and the copies had already drifted in what they tell the
 * operator to do about it.
 */

/**
 * The message names the variable and nothing else. Several of the five are
 * secrets, and this text ends up in a terminal, a CI log and, for the seed, in
 * whatever collects the output of a scheduled job.
 */
const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  // Empty counts as unset. An empty DB_PASSWORD or DB_NAME builds a URL that
  // is syntactically fine and fails at connection time, naming a database
  // nobody meant to reach.
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
