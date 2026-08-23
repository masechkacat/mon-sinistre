import {
  RisqueCatnat,
  SinistreStatus,
  StepAnchor,
  type IsoDate,
  type SinistreDetail,
  type Step,
} from '@mon-sinistre/contracts';
import type { StepPersistedStatus } from 'src/generated/prisma/enums';
import { toSourceReference } from 'src/common/source-reference';
import { dateToIsoDate } from 'src/deadline-rules/resolve-deadline';
import { stepStatus } from './step-status';

/** The `Sinistre` fields `toSinistreDetail` needs off a Prisma row. */
export interface SinistreRow {
  id: string;
  codeInsee: string;
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
}

function toStepResponse(step: StepRow, today: IsoDate): Step {
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

/** Maps a `Sinistre` row and its `Step` rows to the wire `SinistreDetail` — the
 * response body of `POST/GET/PATCH /sinistres/:id`. */
export function toSinistreDetail(
  sinistre: SinistreRow,
  steps: StepRow[],
  today: IsoDate,
): SinistreDetail {
  return {
    id: sinistre.id,
    communeCode: sinistre.codeInsee,
    risque: sinistre.risque as RisqueCatnat,
    eventDate: dateToIsoDate(sinistre.eventDate),
    arreteEntryId: sinistre.arreteEntryId,
    declarationDate: sinistre.declarationDate
      ? dateToIsoDate(sinistre.declarationDate)
      : null,
    status: sinistre.status as SinistreStatus,
    createdAt: sinistre.createdAt.toISOString(),
    steps: steps.map((step) => toStepResponse(step, today)),
  };
}
