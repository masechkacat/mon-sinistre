import { expect, test, type Page } from '@playwright/test';
import { gotoPage, pages } from '../support/pages';

// Matched by paint, not by size variant: the `default` variant paints
// `bg-primary` whether rendered as a button or as a `<Link>` styled with
// `buttonVariants()`, where no `data-size` reaches the DOM.
const shortPrimaryControls = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('a.bg-primary, button.bg-primary')]
      .map((el) => {
        const { width, height } = el.getBoundingClientRect();
        return {
          label: el.textContent?.trim().slice(0, 40) ?? '',
          width,
          height: Math.round(height),
          fontSize: parseFloat(getComputedStyle(el).fontSize),
        };
      })
      .filter((c) => c.width > 0 && (c.height < 48 || c.fontSize < 16)),
  );

const titleOnlyControls = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[title]')]
      .filter(
        (el) =>
          !el.textContent?.trim() &&
          !el.getAttribute('aria-label') &&
          !el.getAttribute('aria-labelledby') &&
          !el.querySelector('img[alt]:not([alt=""]), [aria-label]'),
      )
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}[title="${el.getAttribute('title')}"]`,
      ),
  );

for (const entry of pages) {
  test(`primary actions are touch targets: ${entry.path}`, async ({ page }) => {
    await gotoPage(page, entry);
    expect(await shortPrimaryControls(page)).toEqual([]);
  });

  test(`no control is named by title alone: ${entry.path}`, async ({
    page,
  }) => {
    await gotoPage(page, entry);
    expect(await titleOnlyControls(page)).toEqual([]);
  });
}

test('smoke: a short primary button and a title-only button are reported', async ({
  page,
}) => {
  await page.setContent(
    '<!DOCTYPE html><html lang="fr"><body>' +
      '<button class="bg-primary" style="height:32px;font-size:14px">Envoyer</button>' +
      '<button title="Fermer"><svg></svg></button>' +
      '</body></html>',
  );
  expect(await shortPrimaryControls(page)).toEqual([
    { label: 'Envoyer', width: expect.any(Number), height: 32, fontSize: 14 },
  ]);
  expect(await titleOnlyControls(page)).toEqual(['button[title="Fermer"]']);
});
