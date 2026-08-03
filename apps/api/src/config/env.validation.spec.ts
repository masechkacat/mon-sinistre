import { validateEnv } from './env.validation';

const SECRET = 'x'.repeat(48);

const validEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'mon_sinistre',
  DB_PASSWORD: 'secret',
  DB_NAME: 'mon_sinistre',
  FRONTEND_URL: 'http://localhost:3000',
  MAIL_FROM: 'no-reply@mon-sinistre.test',
  JWT_SECRET: SECRET,
  JWT_REFRESH_SECRET: SECRET,
  COOKIE_SECRET: SECRET,
};

describe('validateEnv', () => {
  it('accepts a minimal valid configuration', () => {
    expect(() => validateEnv(validEnv)).not.toThrow();
  });

  it('coerces numeric strings', () => {
    const env = validateEnv({ ...validEnv, PORT: '3001', SALT_ROUNDS: '12' });
    expect(env.PORT).toBe(3001);
    expect(env.SALT_ROUNDS).toBe(12);
  });

  it('parses HTTPS_ENABLED as a real boolean, not Boolean("false")', () => {
    expect(
      validateEnv({ ...validEnv, HTTPS_ENABLED: 'false' }).HTTPS_ENABLED,
    ).toBe(false);
    expect(
      validateEnv({ ...validEnv, HTTPS_ENABLED: 'true' }).HTTPS_ENABLED,
    ).toBe(true);
  });

  it('rejects a missing required variable', () => {
    const rest: Record<string, unknown> = { ...validEnv };
    delete rest.DB_PASSWORD;
    expect(() => validateEnv(rest)).toThrow(/DB_PASSWORD/);
  });

  it('rejects a secret that is too short', () => {
    expect(() => validateEnv({ ...validEnv, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('does not leak values in the error message', () => {
    const attempt = () =>
      validateEnv({ ...validEnv, JWT_SECRET: 'tell-no-one' });
    expect(attempt).toThrow();
    try {
      attempt();
    } catch (error) {
      expect((error as Error).message).not.toContain('tell-no-one');
    }
  });

  it('requires FRONTEND_URL', () => {
    // Every link of every email is built from it: without a base the mail
    // skeleton would compose "undefined/desabonnement/…" and the unsubscribe
    // link required in each message would lead nowhere.
    const rest: Record<string, unknown> = { ...validEnv };
    delete rest.FRONTEND_URL;
    expect(() => validateEnv(rest)).toThrow(/FRONTEND_URL/);
    expect(() => validateEnv({ ...validEnv, FRONTEND_URL: '' })).toThrow(
      /FRONTEND_URL/,
    );
  });

  it.each([
    ['a bare host', 'localhost:3000'],
    ['a path', '/app'],
    ['an unsupported protocol', 'ftp://example.test'],
    // The mail skeleton joins paths with the URL parser, which drops the path
    // prefix of the base: links would point at the right host and the wrong
    // site, and only a reader clicking one would find out.
    ['a host with a path prefix', 'https://example.test/app'],
    ['a host with a query string', 'https://example.test/?lang=fr'],
  ])('rejects FRONTEND_URL given as %s', (_case, value) => {
    expect(() => validateEnv({ ...validEnv, FRONTEND_URL: value })).toThrow(
      /FRONTEND_URL/,
    );
  });

  it.each([
    ['a host without a TLD, as used locally and in Docker', 'http://web:3000'],
    // The trailing slash is the same origin written differently, and it is
    // what a copy from a browser address bar gives.
    ['a trailing slash', 'https://example.test/'],
  ])('accepts FRONTEND_URL with %s', (_case, value) => {
    // http://localhost:3000 is the value of .env.example: a strict URL check
    // would reject it and break local development.
    expect(() =>
      validateEnv({ ...validEnv, FRONTEND_URL: value }),
    ).not.toThrow();
  });

  it('requires a sender address', () => {
    // The mail skeleton composes no message without it: without this check the
    // refusal would surface at the first send, in a job nobody is watching.
    const rest: Record<string, unknown> = { ...validEnv };
    delete rest.MAIL_FROM;
    expect(() => validateEnv(rest)).toThrow(/MAIL_FROM/);
    expect(() =>
      validateEnv({ ...validEnv, MAIL_FROM: 'pas-une-adresse' }),
    ).toThrow(/MAIL_FROM/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...validEnv, DB_PORT: '70000' })).toThrow(
      /DB_PORT/,
    );
  });
});
