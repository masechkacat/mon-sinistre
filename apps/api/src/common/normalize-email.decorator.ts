import { Transform } from 'class-transformer';

/**
 * Trims and lower-cases an email field before validation runs, so two
 * spellings of the same address (" User@X.fr ", "user@x.fr") reach the
 * service — and any uniqueness check — as one string. Shared by every DTO
 * with a normalized email field (veille subscription, account registration).
 */
export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
