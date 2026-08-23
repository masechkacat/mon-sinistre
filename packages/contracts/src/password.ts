/**
 * Password rules: délibération CNIL n° 2022-100 (21.07.2022), cas n° 2 — 8
 * characters minimum, 3 of 4 categories, combined with a mandatory login
 * attempt limit (`docs/research/user-account.md`). Numbers live here, with
 * their source, so no legal figure is hard-coded elsewhere.
 */

import { SourceReference } from './models';
import { toIsoDate } from './iso-date';

export const PASSWORD_MIN_LENGTH = 8;

/** bcrypt only hashes the first 72 bytes — longer inputs are silently truncated. */
export const PASSWORD_MAX_BYTES = 72;

/** Categories: uppercase, lowercase, digit, special — at least this many required. */
export const PASSWORD_MIN_CHAR_CLASSES = 3;

export const PASSWORD_RULES_SOURCE: SourceReference = {
  url: 'https://www.legifrance.gouv.fr/cnil/id/CNILTEXT000046437451',
  verifiedAt: toIsoDate('2026-08-22'),
  possiblyOutdated: false,
};

/**
 * The "restriction d'accès" mechanism from the same délibération that
 * legitimates the cas n° 2 policy above: 10 failed attempts per address per
 * rolling hour. Counted by HMAC hash of the address regardless of whether an
 * account exists for it (anti-enumeration, `docs/research/user-account.md`) —
 * one counter per address, not per account.
 */
export const LOGIN_ATTEMPT_LIMIT = 10;

const CHAR_CLASS_PATTERNS = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];

/**
 * True when `password` meets the length, byte-length and character-category
 * rules above. Byte length is checked in UTF-8 (`TextEncoder`), not
 * characters: a password of multi-byte characters can cross
 * `PASSWORD_MAX_BYTES` well under that many `.length` characters.
 */
export function isValidPassword(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return false;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return false;
  }
  const classes = CHAR_CLASS_PATTERNS.filter((pattern) =>
    pattern.test(password),
  ).length;
  return classes >= PASSWORD_MIN_CHAR_CLASSES;
}
