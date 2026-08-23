import { createHmac } from 'node:crypto';

/**
 * HMAC-SHA256, not plain SHA-256 — why: docs/research/veille-subscription-lifecycle.md,
 * «Хеш адреса для счётчика писем». Shared by every per-address rate counter
 * (veille form emails, account form emails, login attempts): each caller
 * supplies its own secret, so rotating one counter's key never resets
 * another's.
 */
export const hashEmail = (email: string, secret: string): string =>
  createHmac('sha256', secret).update(email).digest('hex');
