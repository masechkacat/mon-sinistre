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

describe('validateEnv, mail transport', () => {
  const PROVIDER_KEYS = ['SCW_SECRET_KEY', 'SCW_PROJECT_ID'] as const;

  const providerEnv = {
    ...validEnv,
    MAIL_TRANSPORT: 'scaleway',
    MAIL_SENDER_DOMAIN: 'mon-sinistre.test',
    SCW_SECRET_KEY: 'scw-secret',
    SCW_PROJECT_ID: '11111111-2222-4333-8444-555555555555',
  };

  it.each([
    ['no transport named at all', {}],
    ['the local transport named explicitly', { MAIL_TRANSPORT: 'file' }],
    ['an outbox directory of its own', { MAIL_OUTBOX_DIR: '/tmp/outbox' }],
  ])('starts with %s and no provider variable', (_case, extra) => {
    // A fresh clone sends mail locally: neither a Scaleway account nor a key is
    // a condition of running the API.
    expect(() => validateEnv({ ...validEnv, ...extra })).not.toThrow();
  });

  it.each([
    ['nobody implements', 'sendgrid'],
    // "MAIL_TRANSPORT=" reads as "the default", and silence here would make it
    // the local transport in production too.
    ['is written as an empty value', ''],
  ])('rejects a transport that %s', (_case, value) => {
    expect(() => validateEnv({ ...validEnv, MAIL_TRANSPORT: value })).toThrow(
      /MAIL_TRANSPORT/,
    );
  });

  it('rejects an empty outbox directory', () => {
    // Empty is not unset: the messages would land in the working directory,
    // where the .gitignore entry for .mail-outbox does not reach them — and
    // every .txt carries a real address in its To: header.
    expect(() => validateEnv({ ...validEnv, MAIL_OUTBOX_DIR: '' })).toThrow(
      /MAIL_OUTBOX_DIR/,
    );
  });

  it('accepts a complete provider configuration', () => {
    expect(() => validateEnv(providerEnv)).not.toThrow();
  });

  it.each([...PROVIDER_KEYS, 'MAIL_SENDER_DOMAIN'])(
    'refuses to start when the provider sends and %s is missing',
    (missing) => {
      // The point of the check: an incomplete provider configuration stops the
      // application at bootstrap, not at the first send — which happens in a
      // nightly job, with nobody watching and a deadline running.
      const rest: Record<string, unknown> = { ...providerEnv };
      delete rest[missing];
      expect(() => validateEnv(rest)).toThrow(new RegExp(missing));
      expect(() => validateEnv({ ...providerEnv, [missing]: '' })).toThrow(
        new RegExp(missing),
      );
    },
  );

  it.each([
    // Phase 3 compares the part of MAIL_FROM after the @ with this value, so a
    // URL here would fail every sender address rather than the wrong ones.
    ['MAIL_SENDER_DOMAIN', 'https://mon-sinistre.test'],
    // The secret key pasted into the project id, the classic swap of the two.
    ['SCW_PROJECT_ID', 'scw-secret'],
  ])('rejects a malformed %s', (name, value) => {
    expect(() => validateEnv({ ...providerEnv, [name]: value })).toThrow(
      new RegExp(name),
    );
  });

  it('does not name the provider secret in the error it throws', () => {
    const attempt = () =>
      validateEnv({
        ...providerEnv,
        SCW_SECRET_KEY: 'tell-no-one',
        SCW_PROJECT_ID: '',
      });
    expect(attempt).toThrow(/SCW_PROJECT_ID/);
    try {
      attempt();
    } catch (error) {
      expect((error as Error).message).not.toContain('tell-no-one');
    }
  });

  it.each([
    ['names no transport', undefined],
    ['names the local one', 'file'],
  ])('refuses a production start that %s', (_case, transport) => {
    // Otherwise production comes up quietly and writes its emails to files: the
    // reader of an arrêté is never notified and finds out by missing the
    // 30-day deadline. An unset transport is the local one, so it is refused
    // just the same.
    const env: Record<string, unknown> = {
      ...providerEnv,
      NODE_ENV: 'production',
    };
    if (transport === undefined) {
      delete env.MAIL_TRANSPORT;
    } else {
      env.MAIL_TRANSPORT = transport;
    }
    expect(() => validateEnv(env)).toThrow(/MAIL_TRANSPORT/);
  });

  it('accepts a production start that sends through the provider', () => {
    expect(() =>
      validateEnv({ ...providerEnv, NODE_ENV: 'production' }),
    ).not.toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    // A typo such as "prod" would silently switch the guard above off.
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'prod' })).toThrow(
      /NODE_ENV/,
    );
  });
});
