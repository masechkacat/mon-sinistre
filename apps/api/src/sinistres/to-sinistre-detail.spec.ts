import { toIsoDate } from '@mon-sinistre/contracts';
import { DECLARATION_ASSUREUR_CODE } from 'src/deadline-rules/deadline-rule.seed';
import { declarationDeadlineOf, type StepRow } from './to-sinistre-detail';

const TODAY = toIsoDate('2026-08-23');

function step(overrides: Partial<StepRow> = {}): StepRow {
  return {
    id: 'step',
    sinistreId: 'sinistre',
    name: 'Déclarer le sinistre à votre assureur',
    description: '',
    anchor: 'DATE_PUBLICATION_ARRETE',
    plannedDate: new Date('2026-09-01'),
    persistedStatus: null,
    completedAt: null,
    fromTemplate: true,
    sourceUrl: null,
    sourceVerifiedAt: null,
    deadlineRule: { code: DECLARATION_ASSUREUR_CODE },
    ...overrides,
  };
}

describe('declarationDeadlineOf', () => {
  it('is null before the arrêté is published, while the step has no plannedDate', () => {
    expect(
      declarationDeadlineOf([step({ plannedDate: null })], TODAY),
    ).toBeNull();
  });

  it('counts calendar days ahead of today', () => {
    expect(declarationDeadlineOf([step()], TODAY)).toEqual({
      date: toIsoDate('2026-09-01'),
      daysLeft: 9,
    });
  });

  it('is 0 on the deadline day itself', () => {
    expect(
      declarationDeadlineOf(
        [step({ plannedDate: new Date('2026-08-23') })],
        TODAY,
      ),
    ).toEqual({ date: TODAY, daysLeft: 0 });
  });

  it('is negative once the deadline has passed', () => {
    expect(
      declarationDeadlineOf(
        [step({ plannedDate: new Date('2026-08-20') })],
        TODAY,
      ),
    ).toEqual({ date: toIsoDate('2026-08-20'), daysLeft: -3 });
  });

  it('is null once the declaration step is FAIT', () => {
    expect(
      declarationDeadlineOf([step({ persistedStatus: 'FAIT' })], TODAY),
    ).toBeNull();
  });

  it('is null once the declaration step is NON_APPLICABLE', () => {
    expect(
      declarationDeadlineOf(
        [step({ persistedStatus: 'NON_APPLICABLE' })],
        TODAY,
      ),
    ).toBeNull();
  });

  it('reads only the declaration rule, not the insurer deadlines that follow it', () => {
    const insurerStep = step({
      id: 'insurer',
      plannedDate: new Date('2026-08-24'),
      deadlineRule: { code: 'INFORMATION_ASSUREUR' },
    });
    expect(declarationDeadlineOf([insurerStep], TODAY)).toBeNull();
    expect(declarationDeadlineOf([insurerStep, step()], TODAY)).toEqual({
      date: toIsoDate('2026-09-01'),
      daysLeft: 9,
    });
  });
});
