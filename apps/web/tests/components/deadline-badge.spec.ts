import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  badgeCases,
  CASE_ANCHOR,
  CASE_COMPLETED_AT,
  CASE_DATE,
  CASE_DELAY,
  type BadgeCase,
} from '../../src/app/test-bejdz/cases';
import { dateParts, formatDateFr } from '../../src/i18n/date';
import { fr } from '../../src/i18n/fr';
import { DeadlineBadgeState } from '../../src/lib/deadline-badge';
import { expectFace } from '../support/fonts';
import { gotoPage, testBejdz } from '../support/pages';
import { sourceFiles } from '../support/sources';

const copy = fr.deadlineBadge;
const themes = ['light', 'dark'] as const;

/**
 * What each state must say: the words that name it — none for norme, where
 * the countdown and the date are the whole message — and whether the deadline
 * date is on the badge at all.
 */
const expected: Record<
  DeadlineBadgeState,
  { words: string[]; dated: boolean }
> = {
  [DeadlineBadgeState.norme]: { words: [], dated: true },
  [DeadlineBadgeState.derniereSemaine]: {
    words: [copy.derniereSemaine],
    dated: true,
  },
  [DeadlineBadgeState.demain]: { words: [copy.demain], dated: true },
  [DeadlineBadgeState.aujourdhui]: { words: [copy.aujourdhui], dated: true },
  [DeadlineBadgeState.enRetard]: { words: [copy.enRetard], dated: true },
  [DeadlineBadgeState.fait]: {
    words: [copy.fait(formatDateFr(CASE_COMPLETED_AT))],
    dated: true,
  },
  [DeadlineBadgeState.sansObjet]: { words: [copy.sansObjet], dated: false },
  [DeadlineBadgeState.dateAVenir]: {
    words: [copy.dateAVenir, copy.delai(CASE_DELAY, CASE_ANCHOR)],
    dated: false,
  },
};

// The badge lays the date out as a tear-off sheet: month, day, weekday.
const parts = dateParts(CASE_DATE);

function expectedTexts(entry: BadgeCase): string[] {
  const { words, dated } = expected[entry.state];
  const texts = [...words];
  if (!dated) return texts;
  texts.push(parts.month, parts.day, parts.weekday);
  // A done step has nothing left to count down to.
  if (entry.daysLeft !== null && entry.state !== DeadlineBadgeState.fait) {
    texts.push(copy.compteARebours(entry.daysLeft));
  }
  return texts;
}

const badge = (page: Page, state: DeadlineBadgeState): Locator =>
  page.getByTestId(`badge-${state}`);

test('every state names itself and gives its date or its reason', async ({
  page,
}) => {
  await gotoPage(page, testBejdz);
  for (const entry of badgeCases) {
    const locator = badge(page, entry.state);
    for (const text of expectedTexts(entry)) {
      await expect(locator, entry.state).toContainText(text);
    }
  }
});

test('« date à venir » counts the window from the step’s own anchor', async ({
  page,
}) => {
  await gotoPage(page, testBejdz);
  const locator = badge(page, DeadlineBadgeState.dateAVenir);
  await expect(locator).toContainText('après votre déclaration');
  await expect(locator).not.toContainText('arrêté');
});

for (const colorScheme of themes) {
  for (const colour of ['couleur', 'grayscale'] as const) {
    test(`snapshots: ${colorScheme} theme, ${colour}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme });
      await gotoPage(page, testBejdz);
      // The reference for "told apart by word and shape, not by colour":
      // the same badges photographed with every hue removed.
      if (colour === 'grayscale') {
        await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
      }
      for (const entry of badgeCases) {
        await expect(badge(page, entry.state)).toHaveScreenshot([
          'hero',
          entry.state,
          colorScheme,
          `${colour}.png`,
        ]);
      }
    });
  }
}

test('Newsreader is used in two places: the page title and the badge number', async ({
  page,
}) => {
  await gotoPage(page, testBejdz);
  const headingFaces = ['h1', '[data-slot="deadline-number"]'];
  const elsewhere = await page.locator('body').evaluate((body, headings) => {
    const exceptions = headings.join(', ');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const offenders: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || !node.textContent?.trim()) continue;
      if (element.closest(exceptions)) continue;
      const family = getComputedStyle(element).fontFamily.split(',')[0];
      if (!/luciole/i.test(family)) {
        offenders.push(`${node.textContent.trim()}: ${family}`);
      }
    }
    return offenders;
  }, headingFaces);
  expect(elsewhere).toEqual([]);

  for (const selector of headingFaces) {
    await expectFace(page, selector, /newsreader/i);
  }
});

test('the badge is painted in no interactive colour', () => {
  const source = sourceFiles().find(
    ({ path }) => path === 'src/components/deadline-badge.tsx',
  );
  expect(source?.text).not.toMatch(/petrole|primary/);
});
