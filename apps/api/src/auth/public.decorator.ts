import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts an endpoint out of the global `JwtAuthGuard` — mechanics and the
 * fail-closed rationale: `src/auth/CLAUDE.md`. */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
