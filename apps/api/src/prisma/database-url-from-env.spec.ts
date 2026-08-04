import { databaseUrlFromEnv } from './database-url-from-env';

/**
 * The half of the connection string that reads the environment. What it builds
 * out of a given set of values is `buildDatabaseUrl`'s business and is covered
 * next door; here the subject is which names are read and what happens when one
 * of them is not there.
 *
 * Worth its own spec because its callers have none: the Prisma CLI config, the
 * seed and the integration-test client all run outside jest, and a regression
 * here would surface as migrations applied to one database and the application
 * connected to another.
 */
describe('databaseUrlFromEnv', () => {
  const env = (
    overrides: Record<string, string | undefined> = {},
  ): NodeJS.ProcessEnv => ({
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USER: 'mon_sinistre',
    DB_PASSWORD: 'secret',
    DB_NAME: 'mon_sinistre',
    ...overrides,
  });

  it('builds the connection string from the five DB_* variables', () => {
    expect(databaseUrlFromEnv(env())).toBe(
      'postgresql://mon_sinistre:secret@localhost:5432/mon_sinistre',
    );
  });

  it('reads the process environment when it is given none', () => {
    // The default argument is how all three callers use it, so it is the part
    // that has to hold: they pass nothing.
    const saved = { ...process.env };
    Object.assign(process.env, env({ DB_NAME: 'mon_sinistre_test' }));
    try {
      expect(databaseUrlFromEnv()).toBe(
        'postgresql://mon_sinistre:secret@localhost:5432/mon_sinistre_test',
      );
    } finally {
      process.env = saved;
    }
  });

  const DB_VARIABLES = [
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
  ];

  it.each(DB_VARIABLES)('refuses to build a URL without %s', (name) => {
    const attempt = () => databaseUrlFromEnv(env({ [name]: undefined }));

    // Naming the variable is the whole point of the refusal: the alternative
    // is a driver error about a host that reads "undefined".
    expect(attempt).toThrow(name);
  });

  it.each(DB_VARIABLES)('treats an empty %s as not set at all', (name) => {
    // An empty value builds a URL the parser accepts, and the connection then
    // fails somewhere else entirely — against the wrong database, or as an
    // authentication error that says nothing about a missing .env line.
    expect(() => databaseUrlFromEnv(env({ [name]: '' }))).toThrow(name);
  });

  it('never puts a value in the refusal', () => {
    // The password and the user are secrets, and this message goes to a
    // terminal, to CI output and to whatever collects the seed's log.
    const attempt = () => databaseUrlFromEnv(env({ DB_HOST: undefined }));

    expect(attempt).toThrow(/DB_HOST/);
    expect(attempt).not.toThrow(/secret|mon_sinistre/);
  });
});
