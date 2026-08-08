import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { gotoPage, pages } from './pages';

// Landmarks and heading order are "best-practice" axe rules, outside the WCAG
// tags of expectNoAxeViolations — hence the explicit rule list here.
const structureRules = [
  'landmark-one-main',
  'landmark-unique',
  'landmark-banner-is-top-level',
  'landmark-main-is-top-level',
  'landmark-contentinfo-is-top-level',
  'region',
  'page-has-heading-one',
  'heading-order',
];

for (const entry of pages) {
  test(`landmarks and heading order: ${entry.path}`, async ({ page }) => {
    await gotoPage(page, entry);
    const results = await new AxeBuilder({ page })
      .withRules(structureRules)
      .analyze();
    expect(results.violations).toEqual([]);
    // axe has no "banner/contentinfo must exist" rule — assert them directly.
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });

  test(`the service name in the header links home: ${entry.path}`, async ({
    page,
  }) => {
    await gotoPage(page, entry);
    const homeLink = page
      .getByRole('banner')
      .getByRole('link', { name: fr.serviceName });
    await expect(homeLink).toHaveAttribute('href', '/');
  });

  test(`keyboard pass: skip link first, focus visible on every stop: ${entry.path}`, async ({
    page,
  }) => {
    await gotoPage(page, entry);
    const stops: string[] = [];
    let reachedDocumentEnd = false;
    // The bound exists only to terminate a pathological run; the assertion on
    // reachedDocumentEnd below fails if the page has more tab stops than the
    // bound or if focus ever cycles inside the page without reaching the end.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || el === document.body) return null;
        const { outlineStyle, outlineWidth } = getComputedStyle(el);
        return {
          stop: `${el.tagName.toLowerCase()}[href=${el.getAttribute('href')}]`,
          focusVisible: el.matches(':focus-visible'),
          outlineStyle,
          outlineWidth,
        };
      });
      if (info === null) {
        reachedDocumentEnd = true;
        break;
      }
      expect(info.focusVisible).toBe(true);
      // :focus-visible matching is not enough: the outline must actually
      // render, otherwise the focus is programmatic but invisible.
      expect(info.outlineStyle).not.toBe('none');
      expect(parseFloat(info.outlineWidth)).toBeGreaterThan(0);
      stops.push(info.stop);
    }
    expect(reachedDocumentEnd).toBe(true);
    expect(stops[0]).toBe('a[href=#contenu]');
    expect(stops).toContain('a[href=/]');
  });
}
