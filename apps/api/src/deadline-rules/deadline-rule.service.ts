import { Injectable } from '@nestjs/common';
import type { StepAnchor } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * The one query for "which `DeadlineRule` is active for this code and anchor
 * on this date" — every caller that needs a legal deadline resolves through
 * it, not a repeated `where` (docs/research/sinistre-plan.md, «Резолв
 * правила по дате якоря»). Previously private to `JorfMonitorService`
 * (`loadDeclarationRule`); that call site is this class's first caller.
 */
@Injectable()
export class DeadlineRuleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Throws when no row of `code`/`anchor` is active on `onDate`: the product
   * would rather show no deadline than an unconfirmed one (same contract
   * `loadDeclarationRule` had) — an environment whose seed never ran must not
   * fall back to a hard-coded number (ТЗ § 7).
   */
  async resolveActive(code: string, anchor: StepAnchor, onDate: Date) {
    const rule = await this.prisma.deadlineRule.findFirst({
      where: {
        code,
        anchor,
        effectiveFrom: { lte: onDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      },
    });
    if (!rule) {
      throw new Error(
        `no active DeadlineRule ${code} anchored on ${anchor} for ${onDate.toISOString().slice(0, 10)}`,
      );
    }
    return rule;
  }
}
