import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  ACCOUNT_CONFIRM_PATH,
  RisqueCatnat,
  SinistreStatus,
  toIsoDate,
} from '@mon-sinistre/contracts';
import { E2E_ARRETE } from '../../api/test/helpers/arrete';
import { tokenFrom } from '../../api/test/helpers/mail-links';
import { formatDateFr, formatDateShortFr } from '../src/i18n/date';
import { fr } from '../src/i18n/fr';
import { selectCommune } from '../tests/support/communes';
import { fillLoginForm } from '../tests/support/connexion';
import { VALID_PASSWORD } from '../tests/support/form';
import { e2eOutboxDir } from '../tests/support/env';
import { connexion, inscription } from '../tests/support/pages';

// No route.fulfill anywhere in this file: it runs against the real API and
// database (docs/prd/sinistre-plan.md, критерий № 24).

/** Communes of the e2e seed (apps/api/test/helpers/e2e-referential.ts), by the
 * part each one plays: only one of them has an arrêté. `label` is the name as
 * the combobox and the dossier title print it, departement included. */
const AVEC_ARRETE = {
  name: 'Marseille',
  label: 'Marseille (Bouches-du-Rhône)',
};
const SANS_ARRETE = { name: 'Lyon', label: 'Lyon (Rhône)' };

const RISQUE_LABEL = fr.sinistres.risque.options[RisqueCatnat.INONDATION].label;
/** No arrêté covers it: the dossier prepared on it stays «avant arrêté». */
const EVENT_DATE = toIsoDate('2026-09-20');

/** The token the API mailed to `email`, once its .txt has reached the outbox. */
async function confirmationTokenFor(
  email: string,
): Promise<string | undefined> {
  const files = await readdir(e2eOutboxDir).catch(() => []);
  for (const file of files.filter((name) => name.endsWith('.txt'))) {
    const text = await readFile(join(e2eOutboxDir, file), 'utf8');
    if (text.includes(`To: ${email}`)) {
      try {
        return tokenFrom({ text }, ACCOUNT_CONFIRM_PATH);
      } catch {
        return undefined; // Still being written: the poll retries.
      }
    }
  }
  return undefined;
}

async function confirmerCompte(page: Page, email: string): Promise<void> {
  await page.getByLabel(fr.compte.inscription.emailLabel).fill(email);
  await page
    .getByLabel(fr.compte.inscription.passwordLabel)
    .fill(VALID_PASSWORD);
  await page
    .getByRole('button', { name: fr.compte.inscription.submit })
    .click();
  // By role, not text: each title is also read out by the sr-only live region.
  await expect(
    page.getByRole('heading', {
      name: fr.compte.inscription.confirmationSent.title,
    }),
  ).toBeVisible();

  let token: string | undefined;
  await expect
    .poll(async () => (token = await confirmationTokenFor(email)), {
      timeout: 15_000,
    })
    .toBeDefined();
  await page.goto(`${ACCOUNT_CONFIRM_PATH}?token=${token}`);
  await page
    .getByRole('button', { name: fr.compte.confirmation.confirmButton })
    .click();
  await expect(
    page.getByRole('heading', { name: fr.compte.confirmation.confirmed.title }),
  ).toBeVisible();
}

test('from registration to a sinistre with its plan on screen', async ({
  page,
}) => {
  // Unique per run: the e2e database and the outbox survive between runs.
  const email = `parcours-${randomUUID()}@example.fr`;

  await page.goto(inscription.path);
  await confirmerCompte(page, email);

  await page.goto(connexion.path);
  await fillLoginForm(page, { email, password: VALID_PASSWORD });
  await expect(page).toHaveURL('/espace-personnel');

  await page.goto('/sinistres/nouveau');
  await selectCommune(
    page,
    fr.sinistres.nouveau.communeLabel,
    'Paris',
    /Paris/,
  );
  await page.getByRole('radio', { name: RISQUE_LABEL }).click();
  await page.getByLabel(fr.sinistres.nouveau.eventDateLabel).fill('2026-09-05');
  await page.getByRole('button', { name: fr.sinistres.nouveau.submit }).click();

  await expect(page).toHaveURL(/\/sinistres\/[0-9a-f-]{36}$/);
  const timeline = page.getByRole('list', {
    name: fr.sinistres.detail.timelineLabel,
  });
  await expect(timeline).toBeVisible();
  await expect(timeline.getByRole('listitem').first()).toBeVisible();
});

test('from the home page of a commune without an arrêté to the dossier saved by registering', async ({
  page,
}) => {
  const email = `dossier-${randomUUID()}@example.fr`;
  const titre = fr.sinistres.liste.dossierLabel(
    RISQUE_LABEL,
    SANS_ARRETE.label,
  );

  await page.goto('/');
  await selectCommune(page, fr.home.communeLabel, SANS_ARRETE.name, /Lyon/);
  await expect(
    page.getByText(fr.reponseCommune.aucun(SANS_ARRETE.name)),
  ).toBeVisible();

  await page.getByRole('link', { name: fr.reponseCommune.preparer }).click();
  // The commune travelled in the address; the two other parameters are asked
  // for right here, without an account.
  await page.getByRole('radio', { name: RISQUE_LABEL }).click();
  await page.getByLabel(fr.sinistres.nouveau.eventDateLabel).fill(EVENT_DATE);
  await page
    .getByRole('button', { name: fr.dossier.formulaire.submit })
    .click();

  await expect(
    page.getByRole('heading', { level: 1, name: titre }),
  ).toBeVisible();
  await expect(
    page.getByText(fr.sinistres.statut[SinistreStatus.AVANT_ARRETE]),
  ).toBeVisible();

  await page.getByRole('button', { name: fr.dossier.enregistrer }).click();
  // Saving without a session asks for one — and the three parameters are on
  // the registration page, in words rather than as the codes of the address.
  await expect(page.getByTestId('dossier-resume')).toHaveText(
    fr.dossier.resume([
      RISQUE_LABEL,
      SANS_ARRETE.label,
      formatDateFr(EVENT_DATE),
    ]),
  );

  await confirmerCompte(page, email);
  // The confirmation created the sinistre and named it, so the login link of
  // that screen comes back to it.
  await page.getByTestId('compte-confirmation-login-link').click();
  await fillLoginForm(page, { email, password: VALID_PASSWORD });
  await expect(page).toHaveURL(/\/sinistres\/[0-9a-f-]{36}$/);

  await expect(
    page.getByRole('heading', { level: 1, name: titre }),
  ).toBeVisible();
  // The date reappears as the planned day of the first step, which is
  // anchored on the event itself (STEP_TEMPLATE_SEED, order 1).
  const timeline = page.getByRole('list', {
    name: fr.sinistres.detail.timelineLabel,
  });
  await expect(timeline.getByRole('listitem').first()).toContainText(
    fr.deadlineBadge.prevueLe(formatDateShortFr(EVENT_DATE)),
  );
});

test('from the home page of a commune with an arrêté to its published dossier', async ({
  page,
}) => {
  await page.goto('/');
  await selectCommune(
    page,
    fr.home.communeLabel,
    AVEC_ARRETE.name,
    /Marseille/,
  );
  await expect(
    page.getByText(fr.reponseCommune.trouves(1, AVEC_ARRETE.name)),
  ).toBeVisible();

  const carte = page.locator('[data-testid^="arrete-"]');
  await expect(carte).toHaveCount(1);
  await expect(
    carte.getByText(
      fr.reponseCommune.periode(
        formatDateFr(E2E_ARRETE.eventStart),
        formatDateFr(E2E_ARRETE.eventEnd),
      ),
    ),
  ).toBeVisible();
  // The déclaration deadline of a seeded publication ten days old is still
  // running, so it comes as the badge and not as the words of an expired one.
  await expect(carte.locator('[data-slot="deadline-badge"]')).toBeVisible();

  await carte
    .getByRole('link', { name: fr.reponseCommune.ouvrirPour(RISQUE_LABEL) })
    .click();

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: fr.sinistres.liste.dossierLabel(RISQUE_LABEL, AVEC_ARRETE.label),
    }),
  ).toBeVisible();
  await expect(
    page.getByText(fr.sinistres.statut[SinistreStatus.ARRETE_PUBLIE]),
  ).toBeVisible();
  // The button carried the first day of the period, not the day of the visit.
  await expect(
    page.getByText(
      fr.sinistres.liste.eventDate(formatDateFr(E2E_ARRETE.eventStart)),
    ),
  ).toBeVisible();
});
