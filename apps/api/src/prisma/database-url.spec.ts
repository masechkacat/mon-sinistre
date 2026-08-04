import { buildDatabaseUrl } from './database-url';

/**
 * The one function that turns the five DB_* variables into a connection
 * string, and the reason there is no DATABASE_URL: the CLI, the seed, the
 * integration helper and the runtime all call it, so they cannot end up
 * pointing at different databases.
 *
 * Tested without a database, like escapeLikePattern next door: the integration
 * suite exercises the result of this function but needs Docker and does not run
 * in the pre-commit hook, where a regression here would otherwise pass
 * unnoticed — as an application that quietly connects somewhere else.
 *
 * These cases record the behaviour as it is today, ahead of the refactor that
 * changes *who* supplies the five values. Whatever moves, the string built from
 * a given set of them must not.
 */
describe('buildDatabaseUrl', () => {
  const vars = {
    host: 'localhost',
    port: 5432,
    user: 'mon_sinistre',
    password: 'secret',
    database: 'mon_sinistre',
  };

  it('builds the postgresql URL the driver and the CLI both expect', () => {
    expect(buildDatabaseUrl(vars)).toBe(
      'postgresql://mon_sinistre:secret@localhost:5432/mon_sinistre',
    );
  });

  /**
   * The callers disagree on the type and always have: the CLI, the seed and the
   * integration helper read DB_PORT from process.env and hand over a string,
   * while PrismaService takes it from ConfigService, where the schema has
   * already turned it into a number. Both must produce the same string, or the
   * migrations would run against one database and the application against
   * another.
   */
  it('accepts the port as a number or as a string, with the same result', () => {
    expect(buildDatabaseUrl({ ...vars, port: '5432' })).toBe(
      buildDatabaseUrl({ ...vars, port: 5432 }),
    );
  });

  /**
   * A password is generated with `openssl rand -base64 48` (.env.example), so
   * it routinely contains +, / and =. Unencoded, the first slash would end the
   * authority and the rest of the password would be read as a path: the
   * connection would be attempted against a database named after the tail of
   * the secret, and the error would name it.
   */
  it.each([
    ['Kx9+aB/cD=', 'Kx9%2BaB%2FcD%3D'],
    ['p@ss:w/rd+ok=', 'p%40ss%3Aw%2Frd%2Bok%3D'],
    ['mon sinistre', 'mon%20sinistre'],
  ])('percent-encodes the password %s', (password, encoded) => {
    expect(buildDatabaseUrl({ ...vars, password })).toBe(
      `postgresql://mon_sinistre:${encoded}@localhost:5432/mon_sinistre`,
    );
  });

  /**
   * The same treatment for the user: an @ in it would otherwise close the
   * userinfo early and make the rest of the value part of the host.
   */
  it('percent-encodes the user', () => {
    expect(buildDatabaseUrl({ ...vars, user: 'user@corp' })).toBe(
      'postgresql://user%40corp:secret@localhost:5432/mon_sinistre',
    );
  });

  /**
   * Recorded as it is: the host and the database name are interpolated raw.
   * Both are ours — docker-compose writes one and the test setup derives the
   * other by suffixing DB_NAME — and neither has ever carried a character that
   * needs encoding. This case exists so that the refactor cannot change it by
   * accident, not because the current behaviour is the only defensible one.
   */
  it('passes the host and the database name through unchanged', () => {
    expect(
      buildDatabaseUrl({
        ...vars,
        host: 'db.internal',
        database: 'mon_sinistre_test',
      }),
    ).toBe(
      'postgresql://mon_sinistre:secret@db.internal:5432/mon_sinistre_test',
    );
  });
});
