import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectNoAxeViolations(
  page: Page,
  { disabledRules = [] }: { disabledRules?: string[] } = {},
) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(disabledRules)
    .analyze();
  expect(results.violations).toEqual([]);
}
