import { expect, test } from '@playwright/test';

// The stub page has no animated elements, so the probe injects one with
// inline durations: the global rule in globals.css must override them
// (that is why it carries !important) when the user asks for reduced motion.
async function probeDurations(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.createElement('div');
    el.style.transitionDuration = '0.5s';
    el.style.animationDuration = '0.5s';
    document.body.append(el);
    const { transitionDuration, animationDuration } = getComputedStyle(el);
    el.remove();
    return { transitionDuration, animationDuration };
  });
}

test('prefers-reduced-motion: reduce disables transitions and animations', async ({
  page,
}) => {
  await page.goto('/');

  // Control run without the preference: the inline durations must survive,
  // otherwise the assertions below would pass on a page with no rule at all.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const normal = await probeDurations(page);
  expect(normal.transitionDuration).toBe('0.5s');
  expect(normal.animationDuration).toBe('0.5s');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await probeDurations(page);
  expect(parseFloat(reduced.transitionDuration)).toBeLessThan(0.001);
  expect(parseFloat(reduced.animationDuration)).toBeLessThan(0.001);
});
