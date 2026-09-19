import { expect, type Locator, type Route } from '@playwright/test';

/** Meets the CNIL password policy (docs/research/user-account.md) — shared
 * by every spec that submits a password meant to succeed (inscription,
 * connexion, reinitialisation). */
export const VALID_PASSWORD = 'Abc12345!';

/** Too short and a single character class — either flaw alone is enough to
 * fail the CNIL policy; shared by every spec asserting the requirements
 * error (inscription, reinitialisation). */
export const WEAK_PASSWORD = 'abcdefgh';

/** The ids a field points at with `aria-describedby`. A field may point at
 * several (a hint and an error at once), so callers say for themselves
 * whether they mean "among them" or "these and nothing else". */
export async function describedByIds(field: Locator): Promise<string[]> {
  const value = await field.getAttribute('aria-describedby');
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

/** Shared by every spec asserting a field-level error (inscription, veille,
 * connexion): the error must be announced (`role="alert"`) and wired to its
 * field via `aria-describedby`, not just visible next to it. */
export async function expectErrorTiedTo(field: Locator, error: Locator) {
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('role', 'alert');
  const errorId = await error.getAttribute('id');
  expect(errorId).not.toBeNull();
  expect(await describedByIds(field)).toContain(String(errorId));
}

/** Shared by every confirm-by-token spec whose status endpoint answers with
 * nothing but `{ status }` (veille.confirmation, compte.confirmation,
 * compte.reinitialisation) — veille.changement's mock carries more than a
 * status and stays local to its own spec. */
export function fulfillStatus(route: Route, status: string) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status }),
  });
}
