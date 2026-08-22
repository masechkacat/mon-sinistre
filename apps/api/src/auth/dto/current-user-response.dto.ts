import type { CurrentUserResponse } from '@mon-sinistre/contracts';

/**
 * Swagger-only mirror of {@link CurrentUserResponse} — `implements` makes the
 * compiler fail here whenever the contract changes.
 */
export class CurrentUserResponseDto implements CurrentUserResponse {
  email: string;
}
