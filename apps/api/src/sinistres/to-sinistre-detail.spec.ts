import { toIsoDate } from '@mon-sinistre/contracts';
import { DECLARATION_ASSUREUR_CODE } from 'src/deadline-rules/deadline-rule.seed';
import { declarationDeadlineOf, type StepRow } from './to-sinistre-detail';

const TODAY = toIsoDate('2026-08-23');

const SOURCE = {
  url: 'https://www.legifrance.gouv.fr/codes/id/LEGIARTI000006792617',
  verifiedAt: toIsoDate('2026-08-18'),
  possiblyOutdated: false,
};

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
    sourceUrl: SOURCE.url,
    sourceVerifiedAt: new Date('2026-08-18'),
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
      source: SOURCE,
    });
  });

  it('is 0 on the deadline day itself', () => {
    expect(
      declarationDeadlineOf(
        [step({ plannedDate: new Date('2026-08-23') })],
        TODAY,
      ),
    ).toEqual({ date: TODAY, daysLeft: 0, source: SOURCE });
  });

  it('is negative once the deadline has passed', () => {
    expect(
      declarationDeadlineOf(
        [step({ plannedDate: new Date('2026-08-20') })],
        TODAY,
      ),
    ).toEqual({ date: toIsoDate('2026-08-20'), daysLeft: -3, source: SOURCE });
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
      source: SOURCE,
    });
  });

  it('marks the source as possibly outdated once it was not checked for six months', () => {
    expect(
      declarationDeadlineOf(
        [step({ sourceVerifiedAt: new Date('2026-02-22') })],
        TODAY,
      )?.source.possiblyOutdated,
    ).toBe(true);
  });

  it('is null when the declaration step cites no source, so the date is not shown unsourced', () => {
    expect(
      declarationDeadlineOf(
        [step({ sourceUrl: null, sourceVerifiedAt: null })],
        TODAY,
      ),
    ).toBeNull();
    expect(
      declarationDeadlineOf([step({ sourceVerifiedAt: null })], TODAY),
    ).toBeNull();
  });
});
