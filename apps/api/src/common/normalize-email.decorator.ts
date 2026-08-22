import { Transform } from 'class-transformer';

/**
 * Trims and lower-cases an address so two spellings (" User@X.fr ",
 * "user@x.fr") compare equal. The one implementation, called both by the
 * decorator below (DTO fields) and directly where a value never passes
 * through `class-transformer` — passport-local reads `email` off the raw
 * request body, ahead of the DTO pipe (`src/auth/local.strategy.ts`).
 */
export const normalizeEmail = (value: string): string =>
  value.trim().toLowerCase();

/**
 * Trims and lower-cases an email field before validation runs, so two
 * spellings of the same address (" User@X.fr ", "user@x.fr") reach the
 * service — and any uniqueness check — as one string. Shared by every DTO
 * with a normalized email field (veille subscription, account registration).
 */
export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }): unknown =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  );
