import { expect, test } from '@playwright/test';
import { StepStatus, toIsoDate } from '@mon-sinistre/contracts';
import { nextUpcomingStep } from '../../src/lib/sinistre-timeline';
import { stepFixture as step } from '../support/sinistres';

test('the next step is the earliest dated step that is still to come', () => {
  const next = nextUpcomingStep([
    step({
      id: 'later',
      plannedDate: toIsoDate('2027-01-15'),
      status: StepStatus.A_VENIR,
    }),
    step({ id: 'soon', plannedDate: toIsoDate('2026-10-20'), status: StepStatus.A_FAIRE }),
  ]);

  expect(next?.id).toBe('soon');
});

test('a step without a planned date is never the next one', () => {
  const next = nextUpcomingStep([
    step({ id: 'sans-date', plannedDate: null, status: StepStatus.A_VENIR }),
    step({
      id: 'dated',
      plannedDate: toIsoDate('2027-01-15'),
      status: StepStatus.A_VENIR,
    }),
  ]);

  expect(next?.id).toBe('dated');
});

test('an overdue, done or not-applicable step is not upcoming', () => {
  const next = nextUpcomingStep([
    step({
      id: 'retard',
      plannedDate: toIsoDate('2026-09-01'),
      status: StepStatus.EN_RETARD,
    }),
    step({ id: 'fait', plannedDate: toIsoDate('2026-10-01'), status: StepStatus.FAIT }),
    step({
      id: 'na',
      plannedDate: toIsoDate('2026-10-02'),
      status: StepStatus.NON_APPLICABLE,
    }),
  ]);

  expect(next).toBeNull();
});

test('on a tie the earlier step in the plan wins', () => {
  const next = nextUpcomingStep([
    step({
      id: 'first',
      plannedDate: toIsoDate('2026-10-20'),
      status: StepStatus.A_FAIRE,
    }),
    step({
      id: 'second',
      plannedDate: toIsoDate('2026-10-20'),
      status: StepStatus.A_FAIRE,
    }),
  ]);

  expect(next?.id).toBe('first');
});
