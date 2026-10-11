import { Injectable, type Logger } from '@nestjs/common';
import type { IsoDate } from '@mon-sinistre/contracts';
import { errorSummary, stackOf } from 'src/common/error-report';
import type { StepAnchor } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { DECLARATION_ASSUREUR_CODE } from './deadline-rule.seed';
import type { DeadlineRuleModel } from 'src/generated/prisma/models/DeadlineRule';
import { dateToIsoDate, isoDateToDate } from './resolve-deadline';

/** Only a line the arrêté recognises carries the déclaration délai: a
 * refusal dates nothing, whatever rule is active (ТЗ § 3.3). */
export const carriesDeclarationDelai = (outcome: string): boolean =>
  outcome === 'RECONNU';

/** What {@link DeadlineRuleService.resolveActive} throws for a gap in the
 * referential — the one failure a reader may go on without the rule from. */
export class NoActiveDeadlineRuleError extends Error {
  constructor(code: string, anchor: StepAnchor, onDate: Date) {
    super(
      `no active DeadlineRule ${code} anchored on ${anchor} for ${onDate.toISOString().slice(0, 10)}`,
    );
    this.name = NoActiveDeadlineRuleError.name;
  }
}

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
      throw new NoActiveDeadlineRuleError(code, anchor, onDate);
    }
    return rule;
  }

  /** {@link resolveActive} for a reader that can go on without the rule:
   * `null` and a line in the caller's `logger` saying what went dateless
   * (`consequence`). */
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
      // Only the gap is isolated: "no deadline" over a dropped connection
      // would be the one silence this product exists to prevent.
      if (!(error instanceof NoActiveDeadlineRuleError)) {
        throw error;
      }
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
   * The déclaration rule of each entry of a batch — a lookup, resolved once
   * per publication date before the caller uses any of it: the lines of one
   * arrêté share their date, resolving is a query that throws by design, and
   * the monitor must not resolve inside the transaction that applies a link.
   * An entry the délai does not apply to ({@link carriesDeclarationDelai})
   * answers `null` without a query.
   */
  async declarationRulesFor<
    T extends { outcome: string; arrete: { publishedAt: Date } },
  >(
    entries: readonly T[],
    logger: Logger,
    consequence: string,
  ): Promise<(entry: T) => DeadlineRuleModel | null> {
    const dateOf = (entry: T): IsoDate =>
      dateToIsoDate(entry.arrete.publishedAt);
    const dates = [
      ...new Set(
        entries.filter((e) => carriesDeclarationDelai(e.outcome)).map(dateOf),
      ),
    ];
    const rules = await Promise.all(
      dates.map((date) =>
        this.resolveDeclarationOrNull(isoDateToDate(date), logger, consequence),
      ),
    );
    const byDate = new Map(dates.map((date, index) => [date, rules[index]]));
    return (entry) =>
      carriesDeclarationDelai(entry.outcome)
        ? (byDate.get(dateOf(entry)) ?? null)
        : null;
  }
}
