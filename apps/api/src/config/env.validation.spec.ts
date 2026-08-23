import { validateEnv } from './env.validation';

const SECRET = 'x'.repeat(48);
const OTHER_SECRET = 'y'.repeat(48);

const validEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'mon_sinistre',
  DB_PASSWORD: 'secret',
  DB_NAME: 'mon_sinistre',
  FRONTEND_URL: 'http://localhost:3000',
  MAIL_FROM: 'no-reply@mon-sinistre.test',
  JWT_SECRET: SECRET,
  JWT_REFRESH_SECRET: OTHER_SECRET,
  COOKIE_SECRET: SECRET,
  VEILLE_EMAIL_HASH_SECRET: SECRET,
  ACCOUNT_EMAIL_HASH_SECRET: SECRET,
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

  it('rejects one secret used for both access and refresh tokens', () => {
    expect(() =>
      validateEnv({ ...validEnv, JWT_REFRESH_SECRET: SECRET }),
    ).toThrow(/JWT_REFRESH_SECRET/);
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

  it('accepts a configuration without ADMIN_EMAIL — a fresh clone alerts nobody yet', () => {
    expect(() => validateEnv(validEnv)).not.toThrow();
  });

  it('rejects a malformed ADMIN_EMAIL', () => {
    expect(() =>
      validateEnv({ ...validEnv, ADMIN_EMAIL: 'pas-une-adresse' }),
    ).toThrow(/ADMIN_EMAIL/);
  });

  it('rejects an ADMIN_EMAIL written and left blank — empty is not unset', () => {
    // Which is why .env.example ships the line commented out: dotenv hands a
    // written-but-blank variable over as '', and @IsOptional() only skips
    // undefined. Turning alerts off is deleting the line, not emptying it.
    expect(() => validateEnv({ ...validEnv, ADMIN_EMAIL: '' })).toThrow(
      /ADMIN_EMAIL/,
    );
  });

  it('listens on the port and host of the schema when .env names neither', () => {
    // The values themselves, not the constants that hold them: what this
    // guards is that a fresh clone comes up where the README says it does.
    const env = validateEnv(validEnv);
    expect(env.PORT).toBe(3001);
    expect(env.HOST).toBe('0.0.0.0');
  });

  it('prefers what .env names to the default', () => {
    const env = validateEnv({ ...validEnv, PORT: '4000', HOST: '127.0.0.1' });
    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe('127.0.0.1');
  });

  it('refuses a port or a host set to nothing — empty is not unset', () => {
    // A variable written and left blank is a mistake, not an omission: reading
    // it as unset would hide the typo behind a default that happens to work.
    expect(() => validateEnv({ ...validEnv, PORT: '' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...validEnv, HOST: '' })).toThrow(/HOST/);
  });

  it.each([
    ['above the range', '70000'],
    // Zero is a valid port to the kernel and means "pick any free one" — an
    // API nobody can find the address of, started without a word of warning.
    ['zero', '0'],
    ['not a number at all', 'cinq-mille'],
  ])('rejects a port %s, whichever port it is', (_case, value) => {
    expect(() => validateEnv({ ...validEnv, DB_PORT: value })).toThrow(
      /DB_PORT/,
    );
    expect(() => validateEnv({ ...validEnv, PORT: value })).toThrow(/PORT/);
  });

  it('accepts a token lifetime in ms syntax with a unit', () => {
    const env = validateEnv({ ...validEnv, ACCESS_TOKEN_EXPIRY: '900s' });
    expect(env.ACCESS_TOKEN_EXPIRY).toBe('900s');
  });

  it.each([
    ['left blank', ''],
    // jsonwebtoken reads a bare number as milliseconds: 900 is 0.9 s, an
    // access token that has expired by the time it is issued.
    ['without a unit', '900'],
    ['with a unit ms does not know', '15min'],
    ['zero', '0m'],
  ])(
    'rejects a token lifetime %s at bootstrap, not at first login',
    (_case, value) => {
      expect(() =>
        validateEnv({ ...validEnv, ACCESS_TOKEN_EXPIRY: value }),
      ).toThrow(/ACCESS_TOKEN_EXPIRY/);
    },
  );
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
  const productionEnv = {
    ...providerEnv,
    NODE_ENV: 'production',
    HTTPS_ENABLED: 'true',
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

  it('writes to .mail-outbox when no directory is named', () => {
    // The value, not the constant behind it: what this guards is that a fresh
    // clone puts its messages where the .gitignore entry reaches them.
    expect(validateEnv(validEnv).MAIL_OUTBOX_DIR).toBe('.mail-outbox');
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
    // The check below compares the part of MAIL_FROM after the @ with this
    // value, so a URL here would fail every sender address rather than the
    // wrong ones.
    ['MAIL_SENDER_DOMAIN', 'https://mon-sinistre.test'],
    // The secret key pasted into the project id, the classic swap of the two.
    ['SCW_PROJECT_ID', 'scw-secret'],
  ])('rejects a malformed %s', (name, value) => {
    expect(() => validateEnv({ ...providerEnv, [name]: value })).toThrow(
      new RegExp(name),
    );
  });

  it('blames a malformed sender domain on itself, not on MAIL_FROM', () => {
    // The sender check reads this value whatever the transport, so its format
    // is checked whenever it is written: otherwise a URL here stops the
    // application with "MAIL_FROM is wrong" while MAIL_FROM is right, and the
    // operator inspects the wrong line.
    expect(() =>
      validateEnv({
        ...validEnv,
        MAIL_SENDER_DOMAIN: 'https://mon-sinistre.test',
      }),
    ).toThrow(/MAIL_SENDER_DOMAIN/);
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
    ['at another domain entirely', 'no-reply@ailleurs.test'],
    // A subdomain is verified at the provider separately, so mail sent from
    // one is refused there just as loudly as mail from a stranger's domain.
    [
      'at a subdomain of the verified domain',
      'no-reply@mail.mon-sinistre.test',
    ],
    ['one typo away from the verified domain', 'no-reply@mon-sinsitre.test'],
  ])('refuses a sender address %s', (_case, from) => {
    // The insurance this check buys: a typo in MAIL_FROM otherwise surfaces as
    // mail the provider silently refuses, message by message, with the
    // application perfectly healthy.
    expect(() => validateEnv({ ...providerEnv, MAIL_FROM: from })).toThrow(
      /MAIL_FROM/,
    );
  });

  it('compares the sender domain regardless of case', () => {
    // Domains are case-insensitive, and either value may be typed in any case.
    expect(() =>
      validateEnv({
        ...providerEnv,
        MAIL_FROM: 'No-Reply@MON-SINISTRE.TEST',
        MAIL_SENDER_DOMAIN: 'Mon-Sinistre.test',
      }),
    ).not.toThrow();
  });

  it('checks the sender domain under the local transport too', () => {
    // A typo is made where the value is written, not where it is sent from:
    // catching it in development is the whole point of a bootstrap check.
    expect(() =>
      validateEnv({
        ...validEnv,
        MAIL_SENDER_DOMAIN: 'mon-sinistre.test',
        MAIL_FROM: 'no-reply@ailleurs.test',
      }),
    ).toThrow(/MAIL_FROM/);
  });

  it.each([
    ['left out', undefined],
    // What a half-edited .env carries, and it is still "no domain of ours".
    ['written empty', ''],
    ['written blank', '   '],
  ])('accepts any sender address with the domain %s', (_case, domain) => {
    // Nothing to compare against: a fresh clone writes its messages to files,
    // and no domain of ours is involved.
    const env: Record<string, unknown> = {
      ...validEnv,
      MAIL_FROM: 'no-reply@ailleurs.test',
    };
    if (domain !== undefined) {
      env.MAIL_SENDER_DOMAIN = domain;
    }
    expect(() => validateEnv(env)).not.toThrow();
  });

  it('names both variables and neither value when it refuses', () => {
    const attempt = () =>
      validateEnv({ ...providerEnv, MAIL_FROM: 'no-reply@ailleurs.test' });
    expect(attempt).toThrow(/MAIL_FROM/);
    try {
      attempt();
    } catch (error) {
      // Which two values disagree is the whole content of the message: the
      // address itself must not appear in it, here or in any log that picks
      // the bootstrap failure up.
      expect((error as Error).message).toContain('MAIL_SENDER_DOMAIN');
      expect((error as Error).message).not.toContain('ailleurs.test');
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
    const env: Record<string, unknown> = { ...productionEnv };
    if (transport === undefined) {
      delete env.MAIL_TRANSPORT;
    } else {
      env.MAIL_TRANSPORT = transport;
    }
    expect(() => validateEnv(env)).toThrow(/MAIL_TRANSPORT/);
  });

  it('accepts a production start that sends through the provider over HTTPS', () => {
    expect(() => validateEnv(productionEnv)).not.toThrow();
  });

  it.each([
    ['unset', undefined],
    ['false', 'false'],
  ])('refuses a production start with HTTPS_ENABLED %s', (_case, value) => {
    // The refresh cookie is marked Secure only when HTTPS_ENABLED is true; a
    // production that forgets it would send a 30-day cookie over plain HTTP.
    const env: Record<string, unknown> = { ...productionEnv };
    if (value === undefined) {
      delete env.HTTPS_ENABLED;
    } else {
      env.HTTPS_ENABLED = value;
    }
    expect(() => validateEnv(env)).toThrow(/HTTPS_ENABLED/);
    expect(() =>
      validateEnv({ ...validEnv, HTTPS_ENABLED: 'false' }),
    ).not.toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    // A typo such as "prod" would silently switch the guard above off.
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'prod' })).toThrow(
      /NODE_ENV/,
    );
  });
});
