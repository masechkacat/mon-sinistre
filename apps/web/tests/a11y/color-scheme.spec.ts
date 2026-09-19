import { expect, test } from '@playwright/test';

// What this buys is spelled out where the declaration lives, in globals.css.
for (const [colorScheme, expected] of [
  ['light', 'light'],
  ['dark', 'dark'],
] as const) {
  test(`the document declares color-scheme: ${expected} — theme ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');

    const declared = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    );

    expect(declared).toBe(expected);
  });
}
