import {
  RisqueCatnat,
  SinistreStatus,
  StepAnchor,
  type Commune,
  type DeclarationDeadline,
  type DurationUnit,
  type IsoDate,
  type SinistreDetail,
  type SinistreSummary,
  type SourceReference,
  type Step,
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

/** The `Step` fields `toSinistreDetail` needs off a Prisma row. */
export interface StepRow {
  id: string;
  sinistreId: string;
  name: string;
  description: string;
  anchor: string | null;
  plannedDate: Date | null;
  persistedStatus: StepPersistedStatus | null;
  completedAt: Date | null;
  fromTemplate: boolean;
  sourceUrl: string | null;
  sourceVerifiedAt: Date | null;
  deadlineRule:
    (Pick<ResolvedDeadlineRule, 'duration' | 'unit'> & { code: string }) | null;
}

export function toStepResponse(step: StepRow, today: IsoDate): Step {
  const plannedDate = step.plannedDate ? dateToIsoDate(step.plannedDate) : null;
  return {
    id: step.id,
    sinistreId: step.sinistreId,
    name: step.name,
    description: step.description,
    plannedDate,
    status: stepStatus(
      { plannedDate, persistedStatus: step.persistedStatus },
      today,
    ),
    completedAt: step.completedAt ? dateToIsoDate(step.completedAt) : null,
    fromTemplate: step.fromTemplate,
    anchor: step.anchor as StepAnchor | null,
    source: sourceOf(step, today),
    daysLeft: plannedDate ? daysBetween(today, plannedDate) : null,
    delay: step.deadlineRule
      ? {
          value: step.deadlineRule.duration,
          unit: step.deadlineRule.unit as DurationUnit,
        }
      : null,
  };
}

function sourceOf(step: StepRow, today: IsoDate): SourceReference | null {
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

/** The critical deadline is the step with the déclaration rule (ТЗ § 3.3). */
export function declarationDeadlineOf(
  steps: StepRow[],
  today: IsoDate,
): DeclarationDeadline | null {
  const step = steps.find((candidate) =>
    isDeclarationRule(candidate.deadlineRule?.code),
  );
  const source = step ? sourceOf(step, today) : null;
  if (!step?.plannedDate || !source || step.persistedStatus !== null) {
    return null;
  }
  const date = dateToIsoDate(step.plannedDate);
  return { date, daysLeft: daysBetween(today, date), source };
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
