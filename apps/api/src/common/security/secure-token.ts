import { createHash, randomBytes } from 'node:crypto';

/**
 * 256 bits of entropy, matching `RefreshToken.tokenHash`
 * (docs/research/data-model.md § 5): a token this size cannot be brute-forced,
 * so the hash below needs no salt.
 */
const TOKEN_BYTES = 32;

/** base64url length of a generated token — the bound the DTOs holding tokens
 * are capped at. */
export const SECURE_TOKEN_LENGTH = Math.ceil((TOKEN_BYTES * 4) / 3);

export interface SecureToken {
  /** Goes out in the mail link; never stored. */
  readonly token: string;
  /** SHA-256 hex digest — what the database column actually holds. */
  readonly hash: string;
}

/**
 * A random link token and the hash its owning table stores in its place.
 * Every feature that mails a single-use link (veille subscription, change and
 * unsubscribe tokens; account confirmation) shares this one implementation,
 * so the entropy and hash algorithm cannot drift between them.
 */
export const generateSecureToken = (): SecureToken => {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashSecureToken(token) };
};

export const hashSecureToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
