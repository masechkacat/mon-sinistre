import type { IsoDate } from '@mon-sinistre/contracts';
import type { StepAnchor } from 'src/generated/prisma/enums';
import { resolveDeadline } from 'src/deadline-rules/resolve-deadline';

/** The `StepTemplate` fields `buildStepSnapshot` copies onto a `Step`. */
export interface StepTemplateRow {
  name: string;
  description: string;
  anchor: StepAnchor;
  offsetDays: number | null;
  deadlineRuleCode: string | null;
  order: number;
  sourceUrl: string | null;
  sourceVerifiedAt: Date | null;
}

/** The `DeadlineRule` fields a step needs to print its date and cite its source. */
export interface ResolvedDeadlineRule {
  id: string;
  duration: number;
  unit: 'DAYS' | 'MONTHS';
  sourceUrl: string;
  sourceVerifiedAt: Date;
}

export interface StepSnapshot {
  name: string;
  description: string;
  anchor: StepAnchor;
  offsetDays: number | null;
  plannedDate: IsoDate | null;
  order: number;
  fromTemplate: true;
  deadlineRuleId: string | null;
  sourceUrl: string | null;
  sourceVerifiedAt: Date | null;
}

/**
 * The three-way split a step's `plannedDate` always follows: unresolved
 * anchor → null; a legal step (a rule is expected) → the rule's duration if
 * it resolved, null otherwise; a product step → its own `offsetDays`;
 * neither → null (a reminder with no date, ever). Shared by
 * {@link buildStepSnapshot} (off a `StepTemplate` row, at creation) and
 * `SinistresService`'s `DATE_DECLARATION` recompute (off a persisted `Step`
 * row, which keeps no `deadlineRuleCode` to re-resolve — only the rule
 * version already chosen, or none if that resolution failed then).
 */
export function resolveStepPlannedDate(
  anchorDate: IsoDate | undefined,
  isLegalStep: boolean,
  rule: { duration: number; unit: 'DAYS' | 'MONTHS' } | null,
  offsetDays: number | null,
): IsoDate | null {
  if (anchorDate === undefined) {
    return null;
  }
  if (isLegalStep) {
    return rule ? resolveDeadline(anchorDate, rule.duration, rule.unit) : null;
  }
  return offsetDays !== null
    ? resolveDeadline(anchorDate, offsetDays, 'DAYS')
    : null;
}

/**
 * Snapshots one `StepTemplate` row into a `Step` at sinistre creation
 * (docs/research/sinistre-plan.md, «Шаблон плана», «Как применять»).
 * `plannedDate` is the only field that can stay empty: a product step
 * (`offsetDays`) or legal step (`deadlineRuleCode`) whose anchor has not
 * resolved yet gets no date, but a legal step still carries `rule` — the
 * caller resolves it off the anchor date when known, off the sinistre's
 * creation date otherwise, never leaving a legal step without a source to
 * cite.
 */
export function buildStepSnapshot(
  template: StepTemplateRow,
  anchorDates: Partial<Record<StepAnchor, IsoDate>>,
  rule: ResolvedDeadlineRule | null,
): StepSnapshot {
  const anchorDate = anchorDates[template.anchor];
  const plannedDate = resolveStepPlannedDate(
    anchorDate,
    template.deadlineRuleCode !== null,
    rule,
    template.offsetDays,
  );

  // Источник — из правила, когда оно резолвилось, иначе собственный источник
  // шаблона (docs/research/data-model.md § Step: «копия из шаблона или
  // правила»); url и дата сверки берутся из одного и того же источника, иначе
  // шаг сослался бы на текст, которого по этой дате никто не проверял.
  const source = rule ?? template;

  return {
    name: template.name,
    description: template.description,
    anchor: template.anchor,
    offsetDays: template.offsetDays,
    plannedDate,
    order: template.order,
    fromTemplate: true,
    deadlineRuleId: rule?.id ?? null,
    sourceUrl: source.sourceUrl ?? null,
    sourceVerifiedAt: source.sourceVerifiedAt ?? null,
  };
}
