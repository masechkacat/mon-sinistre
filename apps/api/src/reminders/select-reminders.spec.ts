import { toIsoDate, type IsoDate } from '@mon-sinistre/contracts';
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
      logs.push(scaleLog(reason.offsetDays, plannedDate));
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

  it('gives no scale reason once the planned date has passed', () => {
    expect(selectReminders([stepOn(inDays(-1))], TODAY)).toEqual([]);
  });
});
