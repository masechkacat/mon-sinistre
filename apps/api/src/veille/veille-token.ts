/**
 * The token/hash mechanics (256-bit `randomBytes` → base64url, SHA-256 hex for
 * storage) live in `src/common/secure-token.ts` — shared with account
 * confirmation tokens (`src/auth/`). This module re-exports them under the
 * names veille's own code already calls; behaviour is untouched, tested at the
 * shared implementation (`secure-token.spec.ts`).
 */
export {
  generateSecureToken as generateVeilleToken,
  hashSecureToken as hashVeilleToken,
  SECURE_TOKEN_LENGTH as VEILLE_TOKEN_LENGTH,
} from 'src/common/secure-token';
