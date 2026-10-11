import {
  RisqueCatnat,
  SinistreStatus,
  StepAnchor,
  StepKind,
  type Commune,
  type DeclarationDeadline,
  type DurationUnit,
  type IsoDate,
  type SinistreDetail,
  type SinistreSummary,
  type SourceReference,
  type Step,
  type StepView,
} from '@mon-sinistre/contracts';
import type { StepPersistedStatus } from 'src/generated/prisma/enums';
import { toSourceReference } from 'src/common/source-reference';
import { isDeclarationRule } from 'src/deadline-rules/deadline-rule.seed';
import { dateToIsoDate } from 'src/deadline-rules/resolve-deadline';
import type { ResolvedDeadlineRule } from './build-step-snapshot';
import { daysBetween, stepStatus } from './step-status';

/** The `Sinistre` fields `toSinistreDetail` needs off a Prisma row. */
export interface SinistreRow {
  id: string;
  commune: Commune;
  risque: string;
  eventDate: Date;
  arreteEntryId: string | null;
  declarationDate: Date | null;
  status: string;
  createdAt: Date;
}

/**
 * The step fields a {@link StepView} is computed from — no identity and no
 * marks, so a step that was never saved satisfies it too: a plan can be
 * printed off bare snapshots (docs/research/dossier-preliminaire.md,
 * «Аперçu досье»).
 */
export interface StepViewRow {
  name: string;
  description: string;
  anchor: string | null;
  kind: string;
  plannedDate: Date | null;
  persistedStatus: StepPersistedStatus | null;
  order: number;
  sourceUrl: string | null;
  sourceVerifiedAt: Date | null;
  deadlineRule:
    (Pick<ResolvedDeadlineRule, 'duration' | 'unit'> & { code: string }) | null;
}

/** A saved `Step` row — a {@link StepViewRow} that also has identity and marks. */
export interface StepRow extends StepViewRow {
  id: string;
  sinistreId: string;
  completedAt: Date | null;
  fromTemplate: boolean;
}

/** The part of a step every reader computes the same way — dates, derived
 * status, cited source. {@link toStepResponse} adds what only a saved step
 * has. */
export function toStepView(step: StepViewRow, today: IsoDate): StepView {
  const plannedDate = step.plannedDate ? dateToIsoDate(step.plannedDate) : null;
  return {
    name: step.name,
    description: step.description,
    kind: step.kind as StepKind,
    plannedDate,
    status: stepStatus(
      { plannedDate, persistedStatus: step.persistedStatus },
      today,
    ),
    anchor: step.anchor as StepAnchor | null,
    source: sourceOf(step, today),
    daysLeft: plannedDate ? daysBetween(today, plannedDate) : null,
    delay: step.deadlineRule
      ? {
          value: step.deadlineRule.duration,
          unit: step.deadlineRule.unit as DurationUnit,
        }
      : null,
    order: step.order,
  };
}

export function toStepResponse(step: StepRow, today: IsoDate): Step {
  return {
    ...toStepView(step, today),
    id: step.id,
    sinistreId: step.sinistreId,
    completedAt: step.completedAt ? dateToIsoDate(step.completedAt) : null,
    fromTemplate: step.fromTemplate,
  };
}

function sourceOf(step: StepViewRow, today: IsoDate): SourceReference | null {
  return step.sourceUrl && step.sourceVerifiedAt
    ? toSourceReference(
        step.sourceUrl,
        dateToIsoDate(step.sourceVerifiedAt),
        today,
      )
    : null;
}

/** Maps a `Sinistre` row to the wire `SinistreSummary` — the response body of
 * `GET /sinistres`, and the non-steps half of `SinistreDetail` below. */
export function toSinistreSummary(sinistre: SinistreRow): SinistreSummary {
  return {
    id: sinistre.id,
    commune: sinistre.commune,
    risque: sinistre.risque as RisqueCatnat,
    eventDate: dateToIsoDate(sinistre.eventDate),
    arreteEntryId: sinistre.arreteEntryId,
    declarationDate: sinistre.declarationDate
      ? dateToIsoDate(sinistre.declarationDate)
      : null,
    status: sinistre.status as SinistreStatus,
    createdAt: sinistre.createdAt.toISOString(),
  };
}

/** The wire shape of a déclaration deadline dated `date` and cited from
 * `cited` — a `Step` here, the `DeadlineRule` itself on the public commune
 * page, which has no step to read. */
export function toDeclarationDeadline(
  date: IsoDate,
  cited: { sourceUrl: string; sourceVerifiedAt: Date },
  today: IsoDate,
): DeclarationDeadline {
  return {
    date,
    daysLeft: daysBetween(today, date),
    source: toSourceReference(
      cited.sourceUrl,
      dateToIsoDate(cited.sourceVerifiedAt),
      today,
    ),
  };
}

/** The critical deadline is the step with the déclaration rule (ТЗ § 3.3). */
export function declarationDeadlineOf(
  steps: StepViewRow[],
  today: IsoDate,
): DeclarationDeadline | null {
  const step = steps.find((candidate) =>
    isDeclarationRule(candidate.deadlineRule?.code),
  );
  if (
    !step?.plannedDate ||
    !step.sourceUrl ||
    !step.sourceVerifiedAt ||
    step.persistedStatus !== null
  ) {
    return null;
  }
  return toDeclarationDeadline(
    dateToIsoDate(step.plannedDate),
    { sourceUrl: step.sourceUrl, sourceVerifiedAt: step.sourceVerifiedAt },
    today,
  );
}

/** Maps a `Sinistre` row and its `Step` rows to the wire `SinistreDetail` — the
 * response body of `POST/GET/PATCH /sinistres/:id`. */
export function toSinistreDetail(
  sinistre: SinistreRow,
  steps: StepRow[],
  today: IsoDate,
): SinistreDetail {
  return {
    ...toSinistreSummary(sinistre),
    steps: steps.map((step) => toStepResponse(step, today)),
    declarationDeadline: declarationDeadlineOf(steps, today),
  };
}
