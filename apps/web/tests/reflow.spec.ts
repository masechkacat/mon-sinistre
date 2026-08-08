import { expect, test } from '@playwright/test';
import { gotoPage, pages } from './pages';

// 640 px is not arbitrary: Chrome implements 200 % zoom by shrinking the CSS
// viewport, so a 1280 px window at 200 % IS a 640 px viewport (WCAG 1.4.4,
// 1.4.10 reflow).
const viewports = [
  { label: '320 px', width: 320, height: 568 },
  { label: 'zoom 200 %', width: 640, height: 360 },
] as const;

for (const entry of pages) {
  for (const { label, width, height } of viewports) {
    test(`no horizontal scroll at ${label}: ${entry.path}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await gotoPage(page, entry);
      const widths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
      // The document check alone is blind to containers that clip instead of
      // scrolling (Card sets overflow-hidden): content lost there never widens
      // the page. Any clipping element must fit its content too. Scrolling
      // containers (overflow auto/scroll) keep content reachable and WCAG
      // 1.4.10 allows them, so only hidden/clip are checked.
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('*')]
          .filter((el) =>
            ['hidden', 'clip'].includes(getComputedStyle(el).overflowX),
          )
          .filter((el) => el.scrollWidth > el.clientWidth)
          // el.className is an SVGAnimatedString on SVG elements — the
          // attribute reads as plain text everywhere.
          .map(
            (el) => `${el.tagName.toLowerCase()}.${el.getAttribute('class')}`,
          ),
      );
      expect(clipped).toEqual([]);
    });
  }
}
