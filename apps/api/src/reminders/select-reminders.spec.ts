import {
  OVERDUE_REMINDER_INTERVAL_DAYS,
  OVERDUE_REMINDER_MAX_COUNT,
  toIsoDate,
  type IsoDate,
} from '@mon-sinistre/contracts';
import { DECLARATION_ASSUREUR_CODE } from 'src/deadline-rules/deadline-rule.seed';
import { resolveDeadline } from 'src/deadline-rules/resolve-deadline';
import {
  selectReminders,
  type ReminderCandidateLog,
  type ReminderCandidateStep,
} from './select-reminders';

const TODAY = toIsoDate('2026-10-04');

const inDays = (days: number): IsoDate => resolveDeadline(TODAY, days, 'DAYS');

const stepOn = (
  plannedDate: IsoDate | null,
  overrides: Partial<ReminderCandidateStep> = {},
): ReminderCandidateStep => ({
  id: 'step-1',
  plannedDate,
  persistedStatus: null,
  deadlineRuleCode: null,
  logs: [],
  ...overrides,
});

const scaleLog = (
  offsetDays: number,
  plannedDate: IsoDate,
): ReminderCandidateLog => ({
  kind: 'SCALE',
  offsetDays,
  plannedDate,
  sentOn: resolveDeadline(plannedDate, -offsetDays, 'DAYS'),
});

const overdueLog = (
  plannedDate: IsoDate,
  sentOn: IsoDate,
): ReminderCandidateLog => ({
  kind: 'OVERDUE',
  offsetDays: null,
  plannedDate,
  sentOn,
});

/**
 * Replays one step through daily runs, each at the given remaining days, and
 * returns the remaining days a mail went out at — appending the `ReminderLog`
 * row the sent mail would leave, as the service does.
 */
function sentOffsetsOver(
  remainingDays: readonly number[],
  overrides: Partial<ReminderCandidateStep> = {},
): number[] {
  const plannedDate = inDays(40);
  const logs: ReminderCandidateLog[] = [];
  const sent: number[] = [];

  for (const remaining of remainingDays) {
    const today = resolveDeadline(plannedDate, -remaining, 'DAYS');
    for (const reason of selectReminders(
      [stepOn(plannedDate, { logs, ...overrides })],
      today,
    )) {
      sent.push(reason.offsetDays);
      logs.push(
        reason.kind === 'SCALE'
          ? scaleLog(reason.offsetDays, plannedDate)
          : overdueLog(plannedDate, today),
      );
    }
  }

  return sent;
}

describe('selectReminders — SCALE', () => {
  it('reminds about a plain step at 30, 14 and 3 days, and not in between', () => {
    expect(sentOffsetsOver([31, 30, 15, 14, 3, 2])).toEqual([30, 14, 3]);
  });

  it('reminds about a declaration step at 21, 14, 7, 3 and 1 day, not at 30', () => {
    expect(
      sentOffsetsOver([30, 21, 14, 7, 3, 1], {
        deadlineRuleCode: DECLARATION_ASSUREUR_CODE,
      }),
    ).toEqual([21, 14, 7, 3, 1]);
  });

  it('reminds a sinistre created 9 days before the declaration deadline at 8, 7, 3 and 1 — never at 21 or 14', () => {
    expect(
      sentOffsetsOver([8, 7, 6, 3, 2, 1], {
        deadlineRuleCode: DECLARATION_ASSUREUR_CODE,
      }),
    ).toEqual([8, 7, 3, 1]);
  });

  it('skips a step marked NON_APPLICABLE and one without a date', () => {
    const reasons = selectReminders(
      [
        stepOn(inDays(3), { id: 'moot', persistedStatus: 'NON_APPLICABLE' }),
        stepOn(null, { id: 'anchorless' }),
        stepOn(inDays(3), { id: 'open' }),
      ],
      TODAY,
    );

    expect(reasons).toEqual([
      { stepId: 'open', kind: 'SCALE', offsetDays: 3, plannedDate: inDays(3) },
    ]);
  });

  it('skips a step marked FAIT and reminds again once the mark is removed', () => {
    const marked = stepOn(inDays(3), { persistedStatus: 'FAIT' });

    expect(selectReminders([marked], TODAY)).toEqual([]);
    expect(
      selectReminders([{ ...marked, persistedStatus: null }], TODAY),
    ).toHaveLength(1);
  });

  it('is silent on a second run of the same day', () => {
    const plannedDate = inDays(8);
    const logs = [scaleLog(8, plannedDate)];

    expect(selectReminders([stepOn(plannedDate, { logs })], TODAY)).toEqual([]);
  });

  it('ignores a log left on another plannedDate — the threshold fires anew on the new date', () => {
    const plannedDate = inDays(14);
    const logs = [scaleLog(14, inDays(5))];

    expect(selectReminders([stepOn(plannedDate, { logs })], TODAY)).toEqual([
      { stepId: 'step-1', kind: 'SCALE', offsetDays: 14, plannedDate },
    ]);
  });

  it('treats the planned date itself as a SCALE reason with no days left', () => {
    expect(selectReminders([stepOn(TODAY)], TODAY)).toEqual([
      { stepId: 'step-1', kind: 'SCALE', offsetDays: 0, plannedDate: TODAY },
    ]);
  });
});

describe('selectReminders — OVERDUE', () => {
  it('reminds on the first pass after the date, however long it has passed', () => {
    const reasons = selectReminders(
      [
        stepOn(inDays(-1), { id: 'yesterday' }),
        stepOn(inDays(-10), { id: 'overdue-before-the-dossier' }),
      ],
      TODAY,
    );

    expect(reasons).toEqual([
      {
        stepId: 'yesterday',
        kind: 'OVERDUE',
        offsetDays: -1,
        plannedDate: inDays(-1),
      },
      {
        stepId: 'overdue-before-the-dossier',
        kind: 'OVERDUE',
        offsetDays: -10,
        plannedDate: inDays(-10),
      },
    ]);
  });

  it('waits out the interval between two mails about the same step', () => {
    expect(
      sentOffsetsOver([-1, -4, -1 - OVERDUE_REMINDER_INTERVAL_DAYS]),
    ).toEqual([-1, -8]);
  });

  it('sends no more than the limit, whatever the number of passes', () => {
    const weekly = Array.from(
      { length: OVERDUE_REMINDER_MAX_COUNT + 1 },
      (_, pass) => -1 - pass * OVERDUE_REMINDER_INTERVAL_DAYS,
    );

    expect(sentOffsetsOver(weekly)).toEqual(
      weekly.slice(0, OVERDUE_REMINDER_MAX_COUNT),
    );
  });

  /** The limit of mails, all spent on a date the step no longer carries, the
   * last of them a week ago. */
  const spentOnAnotherDate = (): ReminderCandidateLog[] =>
    Array.from({ length: OVERDUE_REMINDER_MAX_COUNT }, (_, pass) =>
      overdueLog(
        inDays(-40),
        resolveDeadline(
          TODAY,
          -(pass + 1) * OVERDUE_REMINDER_INTERVAL_DAYS,
          'DAYS',
        ),
      ),
    );

  it('opens a new series when the planned date moves — the spent logs are another date’s', () => {
    const movedTo = inDays(-2);

    expect(
      selectReminders([stepOn(movedTo, { logs: spentOnAnotherDate() })], TODAY),
    ).toEqual([
      {
        stepId: 'step-1',
        kind: 'OVERDUE',
        offsetDays: -2,
        plannedDate: movedTo,
      },
    ]);
  });

  it('gives no second overdue reason the same day, even once the date has moved', () => {
    const logs = [...spentOnAnotherDate(), overdueLog(inDays(-9), TODAY)];

    expect(selectReminders([stepOn(inDays(-2), { logs })], TODAY)).toEqual([]);
  });
});
