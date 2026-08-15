import { createHash, randomBytes } from 'node:crypto';

/**
 * 256 bits of entropy, matching `RefreshToken.tokenHash`
 * (docs/research/data-model.md § 5): a token this size cannot be brute-forced,
 * so the hash below needs no salt.
 */
const TOKEN_BYTES = 32;

/** base64url length of a generated token — the bound the DTO holds inputs to. */
export const VEILLE_TOKEN_LENGTH = Math.ceil((TOKEN_BYTES * 4) / 3);

export interface VeilleToken {
  /** Goes out in the mail link; never stored. */
  readonly token: string;
  /** SHA-256 hex digest — what `Veille.confirmTokenHash` /
   * `unsubscribeTokenHash` actually holds. */
  readonly hash: string;
}

export const generateVeilleToken = (): VeilleToken => {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashVeilleToken(token) };
};

export const hashVeilleToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
