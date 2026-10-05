import type { Page } from '@playwright/test';

// next/font mangles the family into `__luciole_<hash>`, so the face is looked
// for inside the first family of the stack, not compared to it.
export async function firstFamily(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily.split(',')[0]);
}
