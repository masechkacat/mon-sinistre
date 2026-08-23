/**
 * The HMAC-SHA256 mechanics live in `src/common/email-hash.ts` — shared with
 * the account form's email-limit and login-attempt counters (`src/auth/`).
 * This module re-exports it under the name veille's own code already calls;
 * behaviour is untouched, tested at the shared implementation
 * (`email-hash.spec.ts`).
 */
export { hashEmail as hashVeilleFormEmail } from 'src/common/security/email-hash';
