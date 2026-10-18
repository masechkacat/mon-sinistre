import {
  DurationUnit,
  RisqueCatnat,
  SinistreStatus,
  StepAnchor,
  StepKind,
} from '@mon-sinistre/contracts';
import type {
  Commune,
  DeclarationDeadline,
  IsoDate,
  SinistreDetail,
  SinistreSummary,
  SourceReference,
  Step,
  StepView,
} from '@mon-sinistre/contracts';
import { enumValue } from '../common/enum-value.js';
import type { StepPersistedStatus } from 'src/generated/prisma/enums.js';
import { toSourceReference } from 'src/common/source-reference.js';
import { isDeclarationRule } from 'src/deadline-rules/deadline-rule.seed.js';
import { dateToIsoDate } from 'src/deadline-rules/resolve-deadline.js';
import type { ResolvedDeadlineRule } from './build-step-snapshot.js';
import { daysBetween, stepStatus } from './step-status.js';

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
    kind: enumValue(StepKind, step.kind),
    plannedDate,
    status: stepStatus(
      { plannedDate, persistedStatus: step.persistedStatus },
      today,
    ),
    anchor: step.anchor === null ? null : enumValue(StepAnchor, step.anchor),
    source: citedSourceOf(step, today),
    daysLeft: plannedDate ? daysBetween(today, plannedDate) : null,
    delay: step.deadlineRule
      ? {
          value: step.deadlineRule.duration,
          unit: enumValue(DurationUnit, step.deadlineRule.unit),
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

/** The wire `SourceReference` of a row that cites its source — a `Step`, or
 * the `DeadlineRule` itself on the public commune page; `null` only when the
 * row may cite none and does not. */
export function citedSourceOf(
  cited: { sourceUrl: string; sourceVerifiedAt: Date },
  today: IsoDate,
): SourceReference;
export function citedSourceOf(
  cited: { sourceUrl: string | null; sourceVerifiedAt: Date | null },
  today: IsoDate,
): SourceReference | null;
export function citedSourceOf(
  cited: { sourceUrl: string | null; sourceVerifiedAt: Date | null },
  today: IsoDate,
): SourceReference | null {
  return cited.sourceUrl && cited.sourceVerifiedAt
    ? toSourceReference(
        cited.sourceUrl,
        dateToIsoDate(cited.sourceVerifiedAt),
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
    risque: enumValue(RisqueCatnat, sinistre.risque),
    eventDate: dateToIsoDate(sinistre.eventDate),
    arreteEntryId: sinistre.arreteEntryId,
    declarationDate: sinistre.declarationDate
      ? dateToIsoDate(sinistre.declarationDate)
      : null,
    status: enumValue(SinistreStatus, sinistre.status),
    createdAt: sinistre.createdAt.toISOString(),
  };
}

/** The wire shape of a déclaration deadline dated `date` — read off a `Step`
 * here, off the `DeadlineRule` on the public commune page. */
export function toDeclarationDeadline(
  date: IsoDate,
  source: SourceReference,
  today: IsoDate,
): DeclarationDeadline {
  return { date, daysLeft: daysBetween(today, date), source };
}

/** The critical deadline is the step with the déclaration rule (ТЗ § 3.3). */
export function declarationDeadlineOf(
  steps: StepViewRow[],
  today: IsoDate,
): DeclarationDeadline | null {
  const step = steps.find((candidate) =>
    isDeclarationRule(candidate.deadlineRule?.code),
  );
  const source = step ? citedSourceOf(step, today) : null;
  if (!step?.plannedDate || !source || step.persistedStatus !== null) {
    return null;
  }
  return toDeclarationDeadline(dateToIsoDate(step.plannedDate), source, today);
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
