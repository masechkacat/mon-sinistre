import type { IsoDate } from '@mon-sinistre/contracts';
import type { StepAnchor } from 'src/generated/prisma/enums';

/** The fields `anchorDatesOf` needs off a `Sinistre` — not the full Prisma row. */
export interface AnchorDatesInput {
  eventDate: IsoDate;
  declarationDate: IsoDate | null;
  /** `arreteEntry.arrete.publishedAt`, or null while nothing is linked. */
  arretePublishedAt: IsoDate | null;
}

/**
 * Resolves to `null` unless *both* dates are known — an empty
 * `declarationDate` is never substituted by `arretePublishedAt` alone
 * (docs/research/sinistre-plan.md, "Опорная дата DATE_DECLARATION = max(декларация, публикация)").
 */
function declarationAnchor(
  declarationDate: IsoDate | null,
  arretePublishedAt: IsoDate | null,
): IsoDate | null {
  if (declarationDate === null || arretePublishedAt === null) {
    return null;
  }
  return declarationDate > arretePublishedAt
    ? declarationDate
    : arretePublishedAt;
}

/**
 * Resolves the plan's three real-date anchors. `DATE_ETAT_ESTIMATIF`,
 * `DATE_ETAT_ESTIMATIF_OU_EXPERTISE` and `DATE_ACCORD_INDEMNISATION` are
 * deliberately absent: the product does not store those dates in MVP, so
 * their steps stay without a `plannedDate` forever
 * (docs/research/sinistre-plan.md, "Сроки страховщика после декларации").
 */
export function anchorDatesOf(
  sinistre: AnchorDatesInput,
): Partial<Record<StepAnchor, IsoDate>> {
  const dates: Partial<Record<StepAnchor, IsoDate>> = {
    DATE_SINISTRE: sinistre.eventDate,
  };
  if (sinistre.arretePublishedAt !== null) {
    dates.DATE_PUBLICATION_ARRETE = sinistre.arretePublishedAt;
  }
  const declaration = declarationAnchor(
    sinistre.declarationDate,
    sinistre.arretePublishedAt,
  );
  if (declaration !== null) {
    dates.DATE_DECLARATION = declaration;
  }
  return dates;
}
