import { expect, type Page } from '@playwright/test';

// next/font mangles the family into `__luciole_<hash>`, so the face is looked
// for inside the first family of the stack, not compared to it.
export async function expectFace(page: Page, selector: string, face: RegExp) {
  const families = await page
    .locator(selector)
    .evaluateAll((elements) =>
      elements.map((el) => getComputedStyle(el).fontFamily.split(',')[0]),
    );
  expect(families, selector).not.toEqual([]);
  for (const family of families) expect(family, selector).toMatch(face);
}
