import { expect, test, type Locator, type Page } from '@playwright/test';
import { StepStatus, type StepView } from '@mon-sinistre/contracts';
import { planCases } from '../../src/app/test-plan/cases';
import { formatDateShortFr } from '../../src/i18n/date';
import { fr } from '../../src/i18n/fr';
import { conteneurLabel } from '../../src/lib/plan-conteneur';
import { gotoPage, testPlan } from '../support/pages';

const copy = fr.sinistres.detail;
const badgeCopy = fr.deadlineBadge;

const containers = planCases.filter(
  ({ kind }) => conteneurLabel(kind) !== null,
);

const plan = (page: Page, mode: 'lecture' | 'edition') =>
  page.getByTestId(`plan-${mode}`);
const item = (list: Locator, step: StepView) =>
  list.getByRole('listitem').filter({ hasText: step.name });
const conteneur = (list: Locator) =>
  list.locator('[data-slot="plan-conteneur"]');

test('read mode: the plan is a list and holds no button at all', async ({
  page,
}) => {
  await gotoPage(page, testPlan);

  const list = plan(page, 'lecture');
  await expect(list.getByRole('listitem')).toHaveCount(planCases.length);
  await expect(list.getByRole('button')).toHaveCount(0);
});

test('read mode: a container step names what will go in it, and nothing else', async ({
  page,
}) => {
  await gotoPage(page, testPlan);

  const list = plan(page, 'lecture');
  for (const step of planCases) {
    const box = conteneur(item(list, step));
    const label = conteneurLabel(step.kind);
    if (label === null) {
      await expect(box, step.name).toHaveCount(0);
      continue;
    }
    await expect(box, step.name).toHaveText(label);
    // Nothing is marked in read mode: no step can carry the done stamp.
    await expect(box, step.name).not.toContainText(badgeCopy.fait(null));
  }
});

test('read mode: each step keeps its date, its reason for having none and its source', async ({
  page,
}) => {
  await gotoPage(page, testPlan);

  const list = plan(page, 'lecture');
  for (const step of planCases) {
    const card = item(list, step);
    if (step.plannedDate) {
      await expect(card, step.name).toContainText(
        badgeCopy.prevueLe(formatDateShortFr(step.plannedDate)),
      );
    } else {
      await expect(card, step.name).toContainText(badgeCopy.dateAVenir);
      if (step.anchor) {
        await expect(card, step.name).toContainText(
          copy.attentePar[step.anchor],
        );
      }
    }
    if (step.source) {
      await expect(card, step.name).toContainText(copy.source.indicative);
    }
  }
});

test('editing mode: the mark buttons stay on container steps too', async ({
  page,
}) => {
  await gotoPage(page, testPlan);

  const list = plan(page, 'edition');
  const photos = containers[0];
  const card = item(list, photos);
  await expect(card.getByRole('button')).toHaveCount(2);

  await card.getByRole('button', { name: copy.marquer.fait }).click();

  await expect(page.getByTestId('dernier-marquage')).toHaveText(
    `${photos.order}:${StepStatus.FAIT}`,
  );
});
