import { expect, test, type Page } from '@playwright/test';
import { gotoPage, home } from '../support/pages';
import { sourceFiles } from '../support/sources';

const googleFontHosts = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// next/font mangles the family into `__luciole_<hash>`, so the face is looked
// for inside the first family of the stack, not compared to it.
async function firstFamily(page: Page, selector: string) {
  return page
    .locator(selector)
    .evaluate((el) => getComputedStyle(el).fontFamily.split(',')[0]);
}

test('the home page loads no font from a Google host', async ({ page }) => {
  const thirdParty: string[] = [];
  page.on('request', (request) => {
    if (googleFontHosts.some((host) => request.url().includes(host))) {
      thirdParty.push(request.url());
    }
  });
  await gotoPage(page, home);
  expect(thirdParty).toEqual([]);
});

test('the text is set in Luciole and the heading in Newsreader', async ({
  page,
}) => {
  await gotoPage(page, home);
  expect(await firstFamily(page, 'body')).toMatch(/luciole/i);
  expect(await firstFamily(page, 'h1')).toMatch(/newsreader/i);
});

test('no source file reaches for Google Fonts', () => {
  const files = sourceFiles();
  expect(files.map(({ path }) => path)).toContain('src/app/fonts.ts');
  // next/font/google self-hosts the files it downloads, so the hosts above
  // never show up in a request: the import is what sends the build to Google.
  const forbidden = [...googleFontHosts, 'next/font/google'];
  expect(
    files
      .filter(({ text }) => forbidden.some((string) => text.includes(string)))
      .map(({ path }) => path),
  ).toEqual([]);
});
