import type { IsoDate } from '@mon-sinistre/contracts';
import { isoDateToDate } from 'src/deadline-rules/resolve-deadline';
import type { Prisma } from 'src/generated/prisma/client';
import { type AnchorDatesInput, anchorDatesOf } from './anchor-dates';
import { resolveStepPlannedDate } from './build-step-snapshot';

/**
 * Rewrites the `plannedDate` of every template step anchored on
 * `DATE_DECLARATION` off the anchor {@link anchorDatesOf} resolves for
 * `sinistre` — the one place that recompute lives, because both sides of
 * `max(declarationDate, arretePublishedAt)` can move: the owner declares (or
 * clears the date) through `SinistresService.update`, and a rectificatif
 * moves the arrêté's publication under an already-declared dossier
 * (`JorfMonitorService.recomputeLinkedSinistres`).
 *
 * @returns the anchor date the steps were dated off, `null` when it does not
 * resolve yet — the caller reports the move, this function performs it.
 */
export async function recomputeDeclarationSteps(
  tx: Prisma.TransactionClient,
  sinistreId: string,
  sinistre: AnchorDatesInput,
): Promise<IsoDate | null> {
  const anchorDate = anchorDatesOf(sinistre).DATE_DECLARATION ?? null;
  // `fromTemplate` does not follow from `anchor`: a user-added step is left
  // anchorless by convention, not by the schema (root `CLAUDE.md`).
  const steps = await tx.step.findMany({
    where: { sinistreId, anchor: 'DATE_DECLARATION', fromTemplate: true },
    include: { deadlineRule: true },
  });
  for (const step of steps) {
    const plannedDate = resolveStepPlannedDate(
      anchorDate ?? undefined,
      step.deadlineRuleId !== null,
      step.deadlineRule,
      step.offsetDays,
    );
    await tx.step.update({
      where: { id: step.id },
      data: { plannedDate: plannedDate ? isoDateToDate(plannedDate) : null },
    });
  }
  return anchorDate;
}
