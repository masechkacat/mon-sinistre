import { StepStatus, toIsoDate } from '@mon-sinistre/contracts';
import { stepStatus } from './step-status';

const TODAY = toIsoDate('2026-08-23');

describe('stepStatus', () => {
  it('is A_VENIR for a step whose anchor has not happened yet (no plannedDate)', () => {
    expect(
      stepStatus({ plannedDate: null, persistedStatus: null }, TODAY),
    ).toBe(StepStatus.A_VENIR);
  });

  it('persistedStatus FAIT overrides an overdue plannedDate', () => {
    expect(
      stepStatus(
        { plannedDate: toIsoDate('2026-01-01'), persistedStatus: 'FAIT' },
        TODAY,
      ),
    ).toBe(StepStatus.FAIT);
  });

  it('persistedStatus NON_APPLICABLE overrides a plannedDate that has not happened yet', () => {
    expect(
      stepStatus(
        {
          plannedDate: toIsoDate('2026-12-31'),
          persistedStatus: 'NON_APPLICABLE',
        },
        TODAY,
      ),
    ).toBe(StepStatus.NON_APPLICABLE);
  });

  it('is EN_RETARD the day after plannedDate', () => {
    expect(
      stepStatus(
        { plannedDate: toIsoDate('2026-08-22'), persistedStatus: null },
        TODAY,
      ),
    ).toBe(StepStatus.EN_RETARD);
  });

  it('is A_FAIRE, not EN_RETARD, when plannedDate is today', () => {
    expect(
      stepStatus(
        { plannedDate: toIsoDate('2026-08-23'), persistedStatus: null },
        TODAY,
      ),
    ).toBe(StepStatus.A_FAIRE);
  });

  it('is A_FAIRE exactly SOON_THRESHOLD_DAYS ahead', () => {
    expect(
      stepStatus(
        { plannedDate: toIsoDate('2026-09-22'), persistedStatus: null },
        TODAY,
      ),
    ).toBe(StepStatus.A_FAIRE);
  });

  it('is A_VENIR one day past SOON_THRESHOLD_DAYS', () => {
    expect(
      stepStatus(
        { plannedDate: toIsoDate('2026-09-23'), persistedStatus: null },
        TODAY,
      ),
    ).toBe(StepStatus.A_VENIR);
  });
});
