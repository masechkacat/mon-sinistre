import { Injectable, type Logger } from '@nestjs/common';
import type { IsoDate } from '@mon-sinistre/contracts';
import { errorSummary, stackOf } from 'src/common/error-report';
import type { StepAnchor } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { DECLARATION_ASSUREUR_CODE } from './deadline-rule.seed';
import { isoDateToDate } from './resolve-deadline';

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

  /**
   * {@link resolveActive} with the gap isolated: `null` and a line in the
   * caller's `logger` instead of the throw. Every reader that can go on
   * without the rule takes this path — a step snapshotted without a deadline,
   * a sinistre linked without a déclaration date, a public page listing the
   * arrêté without its délai — because a gap in the referential must not
   * cost the whole plan, run or page. `consequence` is what the log says
   * went dateless; the logger is the caller's, so the log names the class
   * that needed the rule.
   */
  async resolveActiveOrNull(
    code: string,
    anchor: StepAnchor,
    onDate: Date,
    logger: Logger,
    consequence: string,
  ) {
    try {
      return await this.resolveActive(code, anchor, onDate);
    } catch (error) {
      logger.error(
        `DeadlineRule ${code} on ${anchor} did not resolve for ${onDate.toISOString().slice(0, 10)}, ${consequence}: ${errorSummary(error)}`,
        stackOf(error),
      );
      return null;
    }
  }

  /** The déclaration délai active on a publication date — the one place
   * `DECLARATION_ASSUREUR_CODE` is paired with `DATE_PUBLICATION_ARRETE`. */
  resolveDeclaration(publishedAt: Date) {
    return this.resolveActive(
      DECLARATION_ASSUREUR_CODE,
      'DATE_PUBLICATION_ARRETE',
      publishedAt,
    );
  }

  /** {@link resolveDeclaration} isolated as {@link resolveActiveOrNull}. */
  resolveDeclarationOrNull(
    publishedAt: Date,
    logger: Logger,
    consequence: string,
  ) {
    return this.resolveActiveOrNull(
      DECLARATION_ASSUREUR_CODE,
      'DATE_PUBLICATION_ARRETE',
      publishedAt,
      logger,
      consequence,
    );
  }

  /**
   * {@link resolveDeclarationOrNull} once per distinct date of a batch: the
   * entries of one arrêté share its publication, and resolving is a query
   * that throws by design — the monitor's linking pass and the commune page
   * both need the answer for every entry before they use any of it.
   */
  async resolveDeclarationByDate(
    publishedAts: Iterable<IsoDate>,
    logger: Logger,
    consequence: string,
  ) {
    const dates = [...new Set(publishedAts)];
    const rules = await Promise.all(
      dates.map((date) =>
        this.resolveDeclarationOrNull(isoDateToDate(date), logger, consequence),
      ),
    );
    return new Map(dates.map((date, index) => [date, rules[index] ?? null]));
  }
}
