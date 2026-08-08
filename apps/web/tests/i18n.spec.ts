import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ESLint } from 'eslint';
import { toIsoDate } from '@mon-sinistre/contracts';
import { formatDateFr } from '../src/i18n/date';
import { fr } from '../src/i18n/fr';

test('the rendered page shows strings from the localization file', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle(fr.serviceName);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    fr.serviceName,
  );
  await expect(page.getByText(fr.home.subtitle)).toBeVisible();
  await expect(page.locator('a[href="#contenu"]')).toHaveText(
    fr.layout.skipToContent,
  );
});

test('formatDateFr renders an IsoDate in French without a day shift', () => {
  expect(formatDateFr(toIsoDate('2026-08-04'))).toBe('4 août 2026');
  // Midnight boundaries are where a timezone bug would shift the day.
  expect(formatDateFr(toIsoDate('2026-01-01'))).toBe('1 janvier 2026');
  expect(formatDateFr(toIsoDate('2026-12-31'))).toBe('31 décembre 2026');
});

const webRoot = path.resolve(__dirname, '..');

async function literalViolations(code: string) {
  const eslint = new ESLint({ cwd: webRoot });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(webRoot, 'src/app/lint-smoke.tsx'),
  });
  return result.messages.filter(
    (m) => m.ruleId === 'i18next/no-literal-string',
  );
}

test('smoke: the literal check fails on a French string left in JSX', async () => {
  const messages = await literalViolations(
    'export default function Smoke() {\n' +
      '  return <p>Une chaîne française oubliée</p>;\n' +
      '}\n',
  );
  expect(messages).not.toEqual([]);
});

test('smoke: the literal check fails on a French aria-label', async () => {
  const messages = await literalViolations(
    'export default function Smoke() {\n' +
      '  return <button type="button" aria-label="Fermer la fenêtre" />;\n' +
      '}\n',
  );
  expect(messages).not.toEqual([]);
});

test('smoke: Tailwind classes and dictionary strings pass the literal check', async () => {
  const messages = await literalViolations(
    "import { fr } from '@/i18n/fr';\n" +
      'export default function Smoke() {\n' +
      '  return <p className="mt-4 text-lg">{fr.home.subtitle}</p>;\n' +
      '}\n',
  );
  expect(messages).toEqual([]);
});
