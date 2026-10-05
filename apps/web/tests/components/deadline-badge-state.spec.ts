import { expect, test } from '@playwright/test';
import {
  DEADLINE_URGENT_THRESHOLD_DAYS,
  StepStatus,
} from '@mon-sinistre/contracts';
import {
  DeadlineBadgeState,
  deadlineBadgeState,
} from '../../src/lib/deadline-badge';

test('the days left pick the state, the urgency threshold being its upper bound', () => {
  const state = (daysLeft: number) =>
    deadlineBadgeState({ status: StepStatus.A_FAIRE, daysLeft });

  expect(state(DEADLINE_URGENT_THRESHOLD_DAYS + 1)).toBe(
    DeadlineBadgeState.norme,
  );
  expect(state(DEADLINE_URGENT_THRESHOLD_DAYS)).toBe(
    DeadlineBadgeState.derniereSemaine,
  );
  expect(state(1)).toBe(DeadlineBadgeState.demain);
  expect(state(0)).toBe(DeadlineBadgeState.aujourdhui);
  expect(state(-1)).toBe(DeadlineBadgeState.enRetard);
});

test('a done step is done even with its date in the past', () => {
  expect(deadlineBadgeState({ status: StepStatus.FAIT, daysLeft: -3 })).toBe(
    DeadlineBadgeState.fait,
  );
});

test('a not-applicable step is out of scope whatever its date', () => {
  expect(
    deadlineBadgeState({ status: StepStatus.NON_APPLICABLE, daysLeft: 2 }),
  ).toBe(DeadlineBadgeState.sansObjet);
});

test('a step whose anchor has not happened yet has its date to come', () => {
  expect(
    deadlineBadgeState({ status: StepStatus.A_VENIR, daysLeft: null }),
  ).toBe(DeadlineBadgeState.dateAVenir);
});

test('a wider threshold moves the boundary of the last week', () => {
  const daysLeft = DEADLINE_URGENT_THRESHOLD_DAYS + 1;

  expect(
    deadlineBadgeState({
      status: StepStatus.A_FAIRE,
      daysLeft,
      urgentThresholdDays: daysLeft,
    }),
  ).toBe(DeadlineBadgeState.derniereSemaine);
});
