import {
  DEADLINE_URGENT_THRESHOLD_DAYS,
  StepStatus,
  type Step,
} from '@mon-sinistre/contracts';

export enum DeadlineBadgeState {
  normal = 'normal',
  lastWeek = 'lastWeek',
  tomorrow = 'tomorrow',
  today = 'today',
  overdue = 'overdue',
  fait = 'fait',
  nonApplicable = 'nonApplicable',
  upcomingDate = 'upcomingDate',
}

/**
 * The states a running deadline names in words of urgency: the badge paints
 * them in vermillon, a plan strip spells the word out on its date line.
 */
const URGENT_STATES = [
  DeadlineBadgeState.overdue,
  DeadlineBadgeState.today,
  DeadlineBadgeState.tomorrow,
  DeadlineBadgeState.lastWeek,
] as const;

type UrgentDeadlineState = (typeof URGENT_STATES)[number];

export function isUrgentDeadline(
  state: DeadlineBadgeState,
): state is UrgentDeadlineState {
  return (URGENT_STATES as readonly DeadlineBadgeState[]).includes(state);
}

export function deadlineBadgeState({
  status,
  daysLeft,
}: Pick<Step, 'daysLeft'> & Partial<Pick<Step, 'status'>>): DeadlineBadgeState {
  if (status === StepStatus.FAIT) return DeadlineBadgeState.fait;
  if (status === StepStatus.NON_APPLICABLE)
    return DeadlineBadgeState.nonApplicable;
  if (daysLeft === null) return DeadlineBadgeState.upcomingDate;
  if (daysLeft < 0) return DeadlineBadgeState.overdue;
  if (daysLeft === 0) return DeadlineBadgeState.today;
  if (daysLeft === 1) return DeadlineBadgeState.tomorrow;
  if (daysLeft <= DEADLINE_URGENT_THRESHOLD_DAYS)
    return DeadlineBadgeState.lastWeek;
  return DeadlineBadgeState.normal;
}
