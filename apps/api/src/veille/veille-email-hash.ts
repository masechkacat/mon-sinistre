import { createHmac } from 'node:crypto';

/**
 * HMAC-SHA256, not plain SHA-256 — why: docs/research/veille-subscription-lifecycle.md,
 * «Хеш адреса для счётчика писем».
 */
export const hashVeilleFormEmail = (email: string, secret: string): string =>
  createHmac('sha256', secret).update(email).digest('hex');
