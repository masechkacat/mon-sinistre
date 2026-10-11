import type { Logger } from '@nestjs/common';
import type { IsoDate } from '@mon-sinistre/contracts';
import type { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service';
import { isoDateToDate } from 'src/deadline-rules/resolve-deadline';
import type { StepAnchor } from 'src/generated/prisma/enums';
import type {
  ResolvedDeadlineRule,
  StepTemplateRow,
} from './build-step-snapshot';

/**
 * The rule a template's step cites, resolved off its anchor date (off today
 * while the anchor is unknown), or `null` for a product step. A legal step
 * whose rule does not resolve is snapshotted without one — the `DATE_SINISTRE`
 * steps and the déclaration deadline are what the user came for on day one
 * ({@link DeadlineRuleService.resolveActiveOrNull}).
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
  return deadlineRules.resolveActiveOrNull(
    template.deadlineRuleCode,
    template.anchor,
    isoDateToDate(anchorDates[template.anchor] ?? today),
    logger,
    'step created without a deadline',
  );
}
