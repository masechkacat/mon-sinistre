import { expect, test } from '@playwright/test';
import { gotoOk, pages } from './pages';

// 640 px is not arbitrary: Chrome implements 200 % zoom by shrinking the CSS
// viewport, so a 1280 px window at 200 % IS a 640 px viewport (WCAG 1.4.4,
// 1.4.10 reflow).
const viewports = [
  { label: '320 px', width: 320, height: 568 },
  { label: 'zoom 200 %', width: 640, height: 360 },
] as const;

for (const path of pages) {
  for (const { label, width, height } of viewports) {
    test(`no horizontal scroll at ${label}: ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoOk(page, path);
      const widths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
      // The document check alone is blind to containers that clip instead of
      // scrolling (Card sets overflow-hidden): content lost there never widens
      // the page. Any clipping element must fit its content too.
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('*')]
          .filter((el) => getComputedStyle(el).overflowX !== 'visible')
          .filter((el) => el.scrollWidth > el.clientWidth)
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
      );
      expect(clipped).toEqual([]);
    });
  }
}
