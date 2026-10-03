import {
  RisqueCatnat,
  SinistreStatus,
  StepAnchor,
  type Commune,
  type DeclarationDeadline,
  type IsoDate,
  type SinistreDetail,
  type SinistreSummary,
  type Step,
} from '@mon-sinistre/contracts';
import type { StepPersistedStatus } from 'src/generated/prisma/enums';
import { toSourceReference } from 'src/common/source-reference';
import { DECLARATION_ASSUREUR_CODE } from 'src/deadline-rules/deadline-rule.seed';
import { dateToIsoDate } from 'src/deadline-rules/resolve-deadline';
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
  deadlineRule: { code: string } | null;
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
    source:
      step.sourceUrl && step.sourceVerifiedAt
        ? toSourceReference(
            step.sourceUrl,
            dateToIsoDate(step.sourceVerifiedAt),
            today,
          )
        : null,
  };
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
  const step = steps.find(
    (candidate) => candidate.deadlineRule?.code === DECLARATION_ASSUREUR_CODE,
  );
  if (!step?.plannedDate || step.persistedStatus !== null) {
    return null;
  }
  const date = dateToIsoDate(step.plannedDate);
  return { date, daysLeft: daysBetween(today, date) };
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
