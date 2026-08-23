import { isValidPassword } from '@mon-sinistre/contracts';

/**
 * Same required/requirements branching every password field in the app
 * needs before a submit — mirrors validateEmail (email-pattern.ts): one
 * place so a form cannot silently diverge from another on what counts as
 * "required" versus not meeting the CNIL rules.
 */
export function validatePassword(
  password: string,
  messages: { required: string; requirements: string },
): string | undefined {
  if (password === '') return messages.required;
  if (!isValidPassword(password)) return messages.requirements;
  return undefined;
}
