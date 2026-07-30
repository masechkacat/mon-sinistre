import { validateEnv } from './env.validation';

const SECRET = 'x'.repeat(48);

const validEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'mon_sinistre',
  DB_PASSWORD: 'secret',
  DB_NAME: 'mon_sinistre',
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

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...validEnv, DB_PORT: '70000' })).toThrow(
      /DB_PORT/,
    );
  });
});
