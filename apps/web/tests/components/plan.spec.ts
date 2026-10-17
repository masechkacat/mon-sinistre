import { expect, test, type Locator, type Page } from '@playwright/test';
import { StepKind, StepStatus, type StepView } from '@mon-sinistre/contracts';
import { closCases, planCases } from '../../src/app/test-plan/cases';
import { formatDateShortFr } from '../../src/i18n/date';
import { fr } from '../../src/i18n/fr';
import { conteneurLabel } from '../../src/lib/plan-conteneur';
import { gotoPage, testPlan } from '../support/pages';

const copy = fr.sinistres.detail;
const badgeCopy = fr.deadlineBadge;

const actions = planCases.filter(({ kind }) => kind === StepKind.ACTION);

const feuille = (page: Page, mode: 'lecture' | 'edition') =>
  page.getByTestId(`plan-${mode}`);
// The plan itself, not the row of what is behind it: both are lists on the
// same sheet.
const etapes = (sheet: Locator) =>
  sheet.getByRole('list', { name: copy.timelineLabel });
const strip = (sheet: Locator, step: StepView) =>
  etapes(sheet).getByRole('listitem').filter({ hasText: step.name });
const faits = (sheet: Locator) => sheet.locator('[data-slot="plan-fait"]');

test('read mode: the plan is a list and holds no button at all', async ({
  page,
}) => {
  await gotoPage(page, testPlan);

  const sheet = feuille(page, 'lecture');
  await expect(etapes(sheet).getByRole('listitem')).toHaveCount(
    planCases.length,
  );
  await expect(sheet.getByRole('button')).toHaveCount(0);
});

test('a container names what will go in it and is offered no mark, in either mode', async ({
  page,
}) => {
  await gotoPage(page, testPlan);

  for (const mode of ['lecture', 'edition'] as const) {
    const sheet = feuille(page, mode);
    for (const step of planCases) {
      const label = conteneurLabel(step.kind);
      const box = strip(sheet, step).locator('[data-slot="plan-conteneur"]');
      if (label === null) {
        await expect(box, `${mode} / ${step.name}`).toHaveCount(0);
        continue;
      }
      await expect(box, `${mode} / ${step.name}`).toHaveText(label);
      // A container cannot be closed while it is empty (ТЗ § 3.4), so it is
      // offered no way to be.
      await expect(
        strip(sheet, step).getByRole('button'),
        `${mode} / ${step.name}`,
      ).toHaveCount(0);
    }
  }
  // The marks the editing mode does carry belong to the action steps alone.
  await expect(
    etapes(feuille(page, 'edition')).getByRole('button', {
      name: copy.marquer.fait,
    }),
  ).toHaveCount(actions.length);
});

test('each step keeps its date, its reason for having none and its source — and carries no badge', async ({
  page,
}) => {
  await gotoPage(page, testPlan);

  const sheet = feuille(page, 'lecture');
  for (const step of planCases) {
    const ligne = strip(sheet, step);
    if (step.plannedDate) {
      await expect(ligne, step.name).toContainText(
        badgeCopy.prevueLe(formatDateShortFr(step.plannedDate)),
      );
    } else {
      await expect(ligne, step.name).toContainText(
        step.anchor ? copy.attentePar[step.anchor] : copy.sansDateNiAncre,
      );
    }
    if (step.source) {
      await expect(ligne, step.name).toContainText(copy.source.indicative);
    }
  }
  // The badge belongs to the head of the dossier: on a strip the state is a
  // word of the date line.
  await expect(page.locator('[data-slot="deadline-badge"]')).toHaveCount(0);
  await expect(strip(sheet, planCases[0]), planCases[0].name).toContainText(
    badgeCopy.enRetard,
  );
});

test('a plan with nothing settled yet draws no row of what is behind', async ({
  page,
}) => {
  await gotoPage(page, testPlan);

  await expect(faits(feuille(page, 'lecture'))).toHaveCount(0);
});

test('a settled step leaves the plan for the row of what is behind, which keeps the plan order', async ({
  page,
}) => {
  await gotoPage(page, testPlan);

  const sheet = feuille(page, 'edition');
  const ligne = faits(sheet);
  await expect(ligne.getByRole('listitem')).toHaveCount(closCases.length);
  for (const [index, step] of closCases.entries()) {
    await expect(
      ligne.getByRole('listitem').nth(index),
      step.name,
    ).toContainText(step.name);
    await expect(strip(sheet, step), step.name).toHaveCount(0);
  }
});

test('editing mode: an action step is marked from the plan and unmarked from the row', async ({
  page,
}) => {
  await gotoPage(page, testPlan);

  const sheet = feuille(page, 'edition');
  const [action] = actions;
  const marque = page.getByTestId('dernier-marquage');

  await strip(sheet, action)
    .getByRole('button', { name: copy.marquer.fait })
    .click();
  await expect(marque).toHaveText(`${action.order}:${StepStatus.FAIT}`);

  await faits(sheet)
    .getByRole('listitem')
    .first()
    .getByRole('button', { name: copy.marquer.annuler })
    .click();
  await expect(marque).toHaveText(`${closCases[0].order}:`);
});
