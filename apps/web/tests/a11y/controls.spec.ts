import { expect, test, type Page } from '@playwright/test';
import { gotoPage, pages } from '../support/pages';
import { sourceFiles, type SourceFile } from '../support/sources';

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
  page.evaluate(() => {
    // Not `textContent`: a decorative glyph under `aria-hidden` is text in the
    // DOM and nothing in the accessible name.
    const spokenText = (node: Node): string =>
      node.nodeType === Node.TEXT_NODE
        ? (node.textContent ?? '')
        : node instanceof Element && node.getAttribute('aria-hidden') === 'true'
          ? ''
          : [...node.childNodes].map(spokenText).join('');
    return [...document.querySelectorAll('[title]')]
      .filter(
        (el) =>
          !spokenText(el).trim() &&
          !el.getAttribute('aria-label') &&
          !el.getAttribute('aria-labelledby') &&
          !el.querySelector('img[alt]:not([alt=""]), [aria-label]'),
      )
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}[title="${el.getAttribute('title')}"]`,
      );
  });

// The rendered checks reach only the pages of the registry and the states
// their mocks answer with; the sources hold every primary control, including
// those behind a session or a valid token. Only the `default` variant is held
// to `touch`: that variant is the main action of its screen.
const PRIMARY_USE = /<Button[\s/>](?:=>|[^>])*>|buttonVariants\(\{[^}]*\}/g;
const namesVariant = /(?<![\w-])variant[=:]\s*['"](?!default['"])/;
const namesTouch = /(?<![\w-])size[=:]\s*['"]touch['"]/;
const primaryUsesWithoutTouch = (files: SourceFile[]) =>
  files
    .filter((file) => !file.path.endsWith('components/ui/button.tsx'))
    .flatMap((file) =>
      [...file.text.matchAll(PRIMARY_USE)]
        .map((match) => match[0])
        .filter((use) => !namesVariant.test(use) && !namesTouch.test(use))
        .map((use) => `${file.path}: ${use.replace(/\s+/g, ' ')}`),
    );

test('every primary <Button> and buttonVariants() in src is size touch', () => {
  expect(primaryUsesWithoutTouch(sourceFiles())).toEqual([]);
});

test('smoke: a primary use without touch is reported, the others are not', () => {
  const text = [
    '<Button type="button" onClick={() => go()}>',
    '<Button\n  type="button"\n  size="touch"\n>',
    '<Button variant="outline" />',
    '<Button variant="default" size="touch" />',
    "buttonVariants({ variant: 'outline' })",
    'buttonVariants({ className })',
    '<ButtonGroup>',
  ].join('\n');
  expect(primaryUsesWithoutTouch([{ path: 'src/x.tsx', text }])).toEqual([
    'src/x.tsx: <Button type="button" onClick={() => go()}>',
    'src/x.tsx: buttonVariants({ className }',
  ]);
});

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
      '<button title="Fermer"><span aria-hidden="true">×</span></button>' +
      '<button title="Imprimer">Imprimer</button>' +
      '</body></html>',
  );
  expect(await shortPrimaryControls(page)).toEqual([
    { label: 'Envoyer', width: expect.any(Number), height: 32, fontSize: 14 },
  ]);
  expect(await titleOnlyControls(page)).toEqual(['button[title="Fermer"]']);
});
