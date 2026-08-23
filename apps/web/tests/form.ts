import { expect, type Locator } from '@playwright/test';

/** Shared by every spec asserting a field-level error (inscription, veille,
 * connexion): the error must be announced (`role="alert"`) and wired to its
 * field via `aria-describedby`, not just visible next to it. */
export async function expectErrorTiedTo(field: Locator, error: Locator) {
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('role', 'alert');
  const errorId = await error.getAttribute('id');
  expect(errorId).not.toBeNull();
  await expect(field).toHaveAttribute('aria-describedby', String(errorId));
}
