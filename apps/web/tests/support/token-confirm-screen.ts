import { expect, test, type Locator } from '@playwright/test';
import { fr } from '../../src/i18n/fr';
import { expectNoAxeViolations } from './a11y';
import { deferred } from './deferred';
import { testApiBaseUrl } from './env';
import { stringLeaves } from './strings';

/** The branch of `fr` a mailing hands to `TokenConfirmScreen`. */
interface ConfirmStrings {
  page: { title: string };
  description: string;
  unsubscribeButton: string;
  unsubscribing: string;
  done: { title: string; description: string };
}

interface TokenConfirmScreenCase {
  /** Appears in the test titles, so a failure names the mailing. */
  name: string;
  /** Rooted address of the confirm page, token included. */
  path: string;
  token: string;
  /** Endpoint the button is expected to call, without the base address. */
  endpoint: string;
  strings: ConfirmStrings;
  testId: string;
}

/**
 * The screen behind every unsubscribe link is one component
 * (src/components/token-confirm-screen.tsx), so its behaviour is asserted
 * once and run per mailing — what each spec file adds on top is whatever is
 * true of that mailing alone.
 * Not covered here: axe and the keyboard pass on the button screen, which the
 * shared suites already run for every entry of pages.ts.
 */
export function tokenConfirmScreenSuite({
  name,
  path,
  token,
  endpoint,
  strings,
  testId,
}: TokenConfirmScreenCase) {
  const route = `${testApiBaseUrl}${endpoint}**`;

  test(`${name}: the page shows the button and does not call the API before the click`, async ({
    page,
  }) => {
    let called = false;
    await page.route(route, (routed) => {
      called = true;
      return routed.fulfill({ status: 204 });
    });

    await page.goto(path);

    const button = page.getByRole('button', {
      name: strings.unsubscribeButton,
    });
    await expect(button).toBeVisible();
    expect(called).toBe(false);

    // size="touch" through the rendered box rather than the class name —
    // what the rule in apps/web/CLAUDE.md is about is the target, not the
    // attribute.
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
    await expect(button).toHaveCSS('font-size', '16px');
  });

  test(`${name}: clicking the button sends the token, announces the result, and moves focus to it`, async ({
    page,
  }) => {
    await page.route(route, (routed) => {
      expect(routed.request().method()).toBe('POST');
      expect(JSON.parse(routed.request().postData() ?? '{}')).toEqual({
        token,
      });
      return routed.fulfill({ status: 204 });
    });

    await page.goto(path);
    await page.getByRole('button', { name: strings.unsubscribeButton }).click();

    // Ordering rationale: tests/veille/veille-confirmation.spec.ts, same assertion.
    await expect(page.getByTestId(testId)).toBeFocused();
    const status = page.getByRole('status');
    await expect(status).toContainText(strings.done.title);
    await expect(status).toContainText(strings.done.description);
    await expect(
      page.getByRole('button', { name: strings.unsubscribeButton }),
    ).toHaveCount(0);
  });

  test(`${name}: an unreachable API shows the French error message`, async ({
    page,
  }) => {
    await page.route(route, (routed) => routed.abort());

    await page.goto(path);
    await page.getByRole('button', { name: strings.unsubscribeButton }).click();

    const alert = page.getByTestId('request-error');
    await expect(alert).toHaveAttribute('role', 'alert');
    await expect(alert).toContainText(fr.requestError.title);
  });

  test(`${name}: every string of the branch reaches the screen`, async ({
    page,
  }) => {
    // The pending label lives between the click and the answer, so the answer
    // is held back until it has been read.
    const held = deferred();
    await page.route(route, async (routed) => {
      await held.promise;
      return routed.fulfill({ status: 204 });
    });

    await page.goto(path);
    const seen = new Set<string>();
    // Each string is looked up through the element that is supposed to carry
    // it, and exactly: a title is a substring of its own page heading
    // («Se désinscrire» inside «Se désinscrire de la veille»), and the live
    // region repeats the two strings of the result.
    const expectVisible = async (text: string, locator: Locator) => {
      await expect(locator).toBeVisible();
      seen.add(text);
    };
    const heading = (text: string) =>
      page.getByRole('heading', { name: text, exact: true });
    const button = (text: string) =>
      page.getByRole('button', { name: text, exact: true });

    await expectVisible(strings.page.title, heading(strings.page.title));
    await expectVisible(
      strings.description,
      page.getByText(strings.description, { exact: true }),
    );
    await expectVisible(
      strings.unsubscribeButton,
      button(strings.unsubscribeButton),
    );

    await button(strings.unsubscribeButton).click();
    await expectVisible(strings.unsubscribing, button(strings.unsubscribing));
    held.release();

    await expectVisible(strings.done.title, heading(strings.done.title));
    await expectVisible(
      strings.done.description,
      page.getByText(strings.done.description, { exact: true }),
    );

    expect(stringLeaves(strings).filter((text) => !seen.has(text))).toEqual([]);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`${name}: axe is clean on the result screen — theme ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.route(route, (routed) => routed.fulfill({ status: 204 }));

      await page.goto(path);
      await page
        .getByRole('button', { name: strings.unsubscribeButton })
        .click();
      await expect(
        page.getByRole('heading', { name: strings.done.title }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
}
