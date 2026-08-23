// Deliberately permissive: the server-side @IsEmail (apps/api) is the
// authority, this only screens obviously incomplete input before the request
// leaves the browser. Shared by every form with an email field — a second
// copy would drift the moment one of them tightens or loosens it.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Same required/invalid branching every email field in the app needs before
 * a submit — one place so a form cannot silently diverge from another on
 * what counts as "required" versus "invalid" (e.g. whitespace-only input).
 */
export function validateEmail(
  trimmedValue: string,
  messages: { required: string; invalid: string },
): string | undefined {
  if (trimmedValue === '') return messages.required;
  if (!EMAIL_PATTERN.test(trimmedValue)) return messages.invalid;
  return undefined;
}
