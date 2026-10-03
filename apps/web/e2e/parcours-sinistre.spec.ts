import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fr } from '../src/i18n/fr';
import { VALID_PASSWORD } from '../tests/support/form';
import { e2eOutboxDir } from '../tests/support/env';
import { connexion, inscription } from '../tests/support/pages';

// No route.fulfill anywhere in this file: it runs against the real API and
// database (docs/prd/sinistre-plan.md, критерий № 24).

async function confirmationLinkFor(email: string): Promise<string | undefined> {
  const files = await readdir(e2eOutboxDir).catch(() => []);
  for (const file of files.filter((name) => name.endsWith('.txt'))) {
    const contents = await readFile(join(e2eOutboxDir, file), 'utf8');
    if (!contents.includes(`To: ${email}`)) continue;
    return contents.match(/https?:\/\/\S+\/confirmation\?token=[\w-]+/)?.[0];
  }
  return undefined;
}

test('from registration to a sinistre with its plan on screen', async ({
  page,
}) => {
  // Unique per run: the e2e database and the outbox survive between runs.
  const email = `parcours-${randomUUID()}@example.fr`;

  await page.goto(inscription.path);
  await page.getByLabel(fr.compte.inscription.emailLabel).fill(email);
  await page
    .getByLabel(fr.compte.inscription.passwordLabel)
    .fill(VALID_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.inscription.submit })
    .click();
  await expect(
    page.getByText(fr.compte.inscription.confirmationSent.title),
  ).toBeVisible();

  await expect
    .poll(() => confirmationLinkFor(email), { timeout: 15_000 })
    .toMatch(/\/confirmation\?token=/);
  const confirmation = new URL((await confirmationLinkFor(email)) ?? '');
  await page.goto(confirmation.pathname + confirmation.search);
  await page
    .getByRole('button', { name: fr.compte.confirmation.confirmButton })
    .click();
  await expect(
    page.getByText(fr.compte.confirmation.confirmed.title),
  ).toBeVisible();

  await page.goto(connexion.path);
  await page.getByLabel(fr.compte.connexion.emailLabel).fill(email);
  await page.getByLabel(fr.compte.connexion.passwordLabel).fill(VALID_PASSWORD);
  await page.getByRole('button', { name: fr.compte.connexion.submit }).click();
  await expect(page).toHaveURL('/espace-personnel');

  await page.goto('/sinistres/nouveau');
  const communeInput = page.getByLabel(fr.sinistres.nouveau.communeLabel);
  await communeInput.fill('Paris');
  await page.getByRole('option', { name: /Paris/ }).click();
  await page
    .getByRole('radio', { name: fr.sinistres.risque.options.INONDATION.label })
    .click();
  await page.getByLabel(fr.sinistres.nouveau.eventDateLabel).fill('2026-09-05');
  await page.getByRole('button', { name: fr.sinistres.nouveau.submit }).click();

  await expect(page).toHaveURL(/\/sinistres\/[0-9a-f-]{36}$/);
  const timeline = page.getByRole('list', {
    name: fr.sinistres.detail.timelineLabel,
  });
  await expect(timeline).toBeVisible();
  await expect(timeline.getByRole('listitem').first()).toBeVisible();
});
