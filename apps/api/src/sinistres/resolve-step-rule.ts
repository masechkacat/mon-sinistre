import type { Logger } from '@nestjs/common';
import type { IsoDate } from '@mon-sinistre/contracts';
import { errorSummary, stackOf } from 'src/common/error-report';
import type { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service';
import { isoDateToDate } from 'src/deadline-rules/resolve-deadline';
import type { StepAnchor } from 'src/generated/prisma/enums';
import type {
  ResolvedDeadlineRule,
  StepTemplateRow,
} from './build-step-snapshot';

/**
 * A step whose rule does not resolve is snapshotted without one, the way
 * `JorfMonitorService.drainOutbox` isolates its own call: {@link
 * DeadlineRuleService.resolveActive} throws by design, and a gap in the
 * referential must not cost the whole dossier — the `DATE_SINISTRE` steps
 * and the déclaration deadline are what the user came for on day one. The
 * step keeps no date and no source rather than an unconfirmed one (ТЗ § 7).
 * The failure is reported through the caller's own `logger`, so the log names
 * the class that was building a plan.
 */
export async function resolveStepRule(
  deadlineRules: DeadlineRuleService,
  template: StepTemplateRow,
  anchorDates: Partial<Record<StepAnchor, IsoDate>>,
  today: IsoDate,
  logger: Logger,
): Promise<ResolvedDeadlineRule | null> {
  if (!template.deadlineRuleCode) {
    return null;
  }
  try {
    return await deadlineRules.resolveActive(
      template.deadlineRuleCode,
      template.anchor,
      isoDateToDate(anchorDates[template.anchor] ?? today),
    );
  } catch (error) {
    logger.error(
      `sinistre plan: DeadlineRule ${template.deadlineRuleCode} on ${template.anchor} did not resolve, step created without a deadline: ${errorSummary(error)}`,
      stackOf(error),
    );
    return null;
  }
}
