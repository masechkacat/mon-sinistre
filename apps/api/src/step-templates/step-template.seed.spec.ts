import { STEP_TEMPLATE_SEED } from './step-template.seed';

// A hard-coded legal number in a step's text would duplicate — and drift
// from — the number that lives in DeadlineRule (ТЗ § 7,
// docs/research/sinistre-plan.md, «Шаблон плана»): a step names either
// offsetDays (a product step, no legal meaning) or deadlineRuleCode (whose
// duration the reader gets from the resolved rule), never a digit of its own.
describe('STEP_TEMPLATE_SEED', () => {
  it('has thirteen steps', () => {
    expect(STEP_TEMPLATE_SEED).toHaveLength(13);
  });

  it.each(STEP_TEMPLATE_SEED)(
    'step $order carries no digit in its text',
    (step) => {
      expect(`${step.name} ${step.description}`).not.toMatch(/\d/);
    },
  );

  it('every step is a product step (offsetDays), a legal step (deadlineRuleCode) or a reminder (neither), never both', () => {
    for (const step of STEP_TEMPLATE_SEED) {
      expect(step.offsetDays !== null && step.deadlineRuleCode !== null).toBe(
        false,
      );
    }
  });

  it('orders are unique and contiguous starting at 1', () => {
    const orders = STEP_TEMPLATE_SEED.map((step) => step.order).sort(
      (a, b) => a - b,
    );
    expect(orders).toEqual(
      Array.from({ length: STEP_TEMPLATE_SEED.length }, (_, i) => i + 1),
    );
  });
});
