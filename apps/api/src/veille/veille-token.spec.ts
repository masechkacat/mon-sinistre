import { createHash } from 'node:crypto';

import { generateVeilleToken, hashVeilleToken } from './veille-token';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe('generateVeilleToken', () => {
  it('returns a base64url token with 256 bits of entropy', () => {
    const { token } = generateVeilleToken();

    // 32 random bytes encode to 43 base64url characters (no padding).
    expect(token).toHaveLength(43);
    expect(token).toMatch(BASE64URL);
  });

  it('never returns the same token twice', () => {
    const first = generateVeilleToken();
    const second = generateVeilleToken();

    expect(first.token).not.toBe(second.token);
  });

  it('pairs the token with the SHA-256 hex digest that is stored in its place', () => {
    const { token, hash } = generateVeilleToken();

    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toBe(token);
  });
});

describe('hashVeilleToken', () => {
  it('is a pure function of the token, matching the hash generateVeilleToken pairs it with', () => {
    const { token, hash } = generateVeilleToken();

    expect(hashVeilleToken(token)).toBe(hash);
  });
});
