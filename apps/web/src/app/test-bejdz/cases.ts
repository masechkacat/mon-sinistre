import {
  DurationUnit,
  StepAnchor,
  StepStatus,
  toIsoDate,
  type IsoDate,
  type Step,
} from '@mon-sinistre/contracts';
import {
  deadlineBadgeState,
  type DeadlineBadgeState,
} from '@/lib/deadline-badge';

/** Fixed dates: the screenshots of the sample page have to be reproducible. */
export const CASE_DATE = toIsoDate('2026-10-15');
export const CASE_COMPLETED_AT = toIsoDate('2026-10-12');
export const CASE_DELAY = { value: 30, unit: DurationUnit.DAYS } as const;
export const CASE_ANCHOR = StepAnchor.DATE_DECLARATION;

const inputs = [
  { status: StepStatus.A_VENIR, daysLeft: 30, date: CASE_DATE },
  { status: StepStatus.A_FAIRE, daysLeft: 7, date: CASE_DATE },
  { status: StepStatus.A_FAIRE, daysLeft: 1, date: CASE_DATE },
  { status: StepStatus.A_FAIRE, daysLeft: 0, date: CASE_DATE },
  { status: StepStatus.EN_RETARD, daysLeft: -3, date: CASE_DATE },
  {
    status: StepStatus.FAIT,
    daysLeft: -3,
    date: CASE_DATE,
    completedAt: CASE_COMPLETED_AT,
  },
  { status: StepStatus.NON_APPLICABLE, daysLeft: null, date: CASE_DATE },
  {
    status: StepStatus.A_VENIR,
    daysLeft: null,
    date: null,
    delay: CASE_DELAY,
    anchor: CASE_ANCHOR,
  },
] satisfies {
  status: StepStatus;
  daysLeft: number | null;
  date: IsoDate | null;
  completedAt?: IsoDate;
  delay?: Step['delay'];
  anchor?: Step['anchor'];
}[];

export type BadgeCase = (typeof inputs)[number] & {
  state: DeadlineBadgeState;
};

/**
 * One case per state, each reached through `deadlineBadgeState` rather than
 * named: the sample then shows what the real screen shows for those fields.
 */
export const badgeCases: BadgeCase[] = inputs.map((input) => ({
  ...input,
  state: deadlineBadgeState(input),
}));
