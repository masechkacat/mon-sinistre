import { toIsoDate } from '@mon-sinistre/contracts';
import { buildStepSnapshot } from './build-step-snapshot';

const template = (
  overrides: Partial<{
    anchor: 'DATE_SINISTRE' | 'DATE_PUBLICATION_ARRETE' | 'DATE_DECLARATION';
    offsetDays: number | null;
    deadlineRuleCode: string | null;
    sourceUrl: string | null;
    sourceVerifiedAt: Date | null;
  }> = {},
) => ({
  name: 'Photographier',
  description: 'Avant nettoyage',
  anchor: overrides.anchor ?? ('DATE_SINISTRE' as const),
  offsetDays: overrides.offsetDays === undefined ? 0 : overrides.offsetDays,
  deadlineRuleCode:
    overrides.deadlineRuleCode === undefined
      ? null
      : overrides.deadlineRuleCode,
  order: 1,
  sourceUrl: overrides.sourceUrl ?? null,
  sourceVerifiedAt: overrides.sourceVerifiedAt ?? null,
});

const rule = {
  id: 'rule-1',
  duration: 30,
  unit: 'DAYS' as const,
  sourceUrl: 'https://legifrance.example/',
  sourceVerifiedAt: new Date('2026-08-18'),
};

// docs/research/sinistre-plan.md, «Шаблон плана», «Как применять»: a step's
// deadlineRule resolves always — even off the creation date when its anchor
// isn't known yet — while plannedDate itself stays null until the anchor is.
describe('buildStepSnapshot', () => {
  it('plans a product step (offsetDays) off a resolved anchor date', () => {
    const step = buildStepSnapshot(
      template({ offsetDays: 3 }),
      { DATE_SINISTRE: toIsoDate('2026-06-01') },
      null,
    );
    expect(step.plannedDate).toBe('2026-06-04');
    expect(step.deadlineRuleId).toBeNull();
    expect(step.sourceUrl).toBeNull();
  });

  it('plans a legal step (deadlineRuleCode) using the resolved rule duration, not offsetDays', () => {
    const step = buildStepSnapshot(
      template({
        anchor: 'DATE_PUBLICATION_ARRETE',
        offsetDays: null,
        deadlineRuleCode: 'DECLARATION_ASSUREUR',
      }),
      { DATE_PUBLICATION_ARRETE: toIsoDate('2026-07-01') },
      rule,
    );
    expect(step.plannedDate).toBe('2026-07-31');
    expect(step.deadlineRuleId).toBe('rule-1');
    expect(step.sourceUrl).toBe('https://legifrance.example/');
    expect(step.sourceVerifiedAt).toEqual(new Date('2026-08-18'));
  });

  it('leaves plannedDate null while the anchor has not resolved yet, but still carries the resolved rule', () => {
    const step = buildStepSnapshot(
      template({
        anchor: 'DATE_DECLARATION',
        offsetDays: null,
        deadlineRuleCode: 'INFORMATION_ASSUREUR',
      }),
      {},
      rule,
    );
    expect(step.plannedDate).toBeNull();
    expect(step.deadlineRuleId).toBe('rule-1');
    expect(step.sourceUrl).toBe('https://legifrance.example/');
  });

  it('leaves plannedDate null forever for a reminder step (neither offsetDays nor deadlineRuleCode), even once its anchor resolves', () => {
    const step = buildStepSnapshot(
      template({ anchor: 'DATE_DECLARATION', offsetDays: null }),
      { DATE_DECLARATION: toIsoDate('2026-07-05') },
      null,
    );
    expect(step.plannedDate).toBeNull();
    expect(step.deadlineRuleId).toBeNull();
  });

  it('cites the template own source when the step has no rule of its own', () => {
    const step = buildStepSnapshot(
      template({
        offsetDays: 3,
        sourceUrl: 'https://service-public.example/',
        sourceVerifiedAt: new Date('2026-08-20'),
      }),
      { DATE_SINISTRE: toIsoDate('2026-06-01') },
      null,
    );
    expect(step.sourceUrl).toBe('https://service-public.example/');
    expect(step.sourceVerifiedAt).toEqual(new Date('2026-08-20'));
  });

  it('cites the rule rather than the template when both carry a source', () => {
    const step = buildStepSnapshot(
      template({
        anchor: 'DATE_PUBLICATION_ARRETE',
        offsetDays: null,
        deadlineRuleCode: 'DECLARATION_ASSUREUR',
        sourceUrl: 'https://service-public.example/',
        sourceVerifiedAt: new Date('2026-08-20'),
      }),
      { DATE_PUBLICATION_ARRETE: toIsoDate('2026-07-01') },
      rule,
    );
    expect(step.sourceUrl).toBe('https://legifrance.example/');
    expect(step.sourceVerifiedAt).toEqual(new Date('2026-08-18'));
  });

  it('copies name, description, anchor, offsetDays and order straight from the template', () => {
    const step = buildStepSnapshot(
      {
        ...template({ offsetDays: 7 }),
        name: 'Vérifier',
        description: 'Mairie',
        order: 6,
      },
      {},
      null,
    );
    expect(step.name).toBe('Vérifier');
    expect(step.description).toBe('Mairie');
    expect(step.anchor).toBe('DATE_SINISTRE');
    expect(step.offsetDays).toBe(7);
    expect(step.order).toBe(6);
    expect(step.fromTemplate).toBe(true);
  });
});
