import { Injectable, Logger } from '@nestjs/common';
import {
  ArreteEntryOutcome,
  COMMUNE_ARRETES_WINDOW_MONTHS,
  type CommuneArrete,
  type CommuneArretes,
  type DeclarationDeadline,
  type DossierApercu,
  type IsoDate,
  type RisqueCatnat,
} from '@mon-sinistre/contracts';
import { errorSummary, stackOf } from 'src/common/error-report';
import { toSourceReference } from 'src/common/source-reference';
import { todayInParis } from 'src/common/time/today-in-paris';
import { requireActiveCommune } from 'src/communes/active-commune';
import { loadSuccessorMap } from 'src/communes/load-successor-map';
import { predecessorCodesOf } from 'src/communes/predecessor-codes';
import { DECLARATION_ASSUREUR_CODE } from 'src/deadline-rules/deadline-rule.seed';
import { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service';
import {
  dateToIsoDate,
  isoDateToDate,
  resolveDeadline,
} from 'src/deadline-rules/resolve-deadline';
import { classifyRisques } from 'src/jorf/parse/classify-risques';
import { PrismaService } from 'src/prisma/prisma.service';
import type { CreateSinistreDto } from 'src/sinistres/dto/create-sinistre.dto';
import type { MatchedArrete } from 'src/sinistres/match-arrete';
import { planDossier, toPlannedView } from 'src/sinistres/snapshot-plan';
import { daysBetween } from 'src/sinistres/step-status';
import {
  declarationDeadlineOf,
  toStepView,
} from 'src/sinistres/to-sinistre-detail';

@Injectable()
export class DossierService {
  private readonly logger = new Logger(DossierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deadlineRules: DeadlineRuleService,
  ) {}

  /** The plan the three parameters would get as a sinistre, computed by
   * {@link planDossier} and thrown away. */
  async apercu(dto: CreateSinistreDto): Promise<DossierApercu> {
    const { commune, today, match, plan, status } = await planDossier(
      this.prisma,
      this.deadlineRules,
      dto,
      this.logger,
    );
    const steps = plan.map(toPlannedView);

    return {
      commune,
      risque: dto.risque,
      eventDate: dto.eventDate,
      status,
      arrete: match && arreteOf(match),
      steps: steps.map((step) => toStepView(step, today)),
      declarationDeadline: declarationDeadlineOf(steps, today),
    };
  }

  /** Every annexe line naming the commune in the last
   * `COMMUNE_ARRETES_WINDOW_MONTHS` — research, «Ответ по коммуне» owns the
   * window, the entry-level unit and the predecessor codes. */
  async arretes(codeInsee: string): Promise<CommuneArretes> {
    const [commune, successorOf] = await Promise.all([
      requireActiveCommune(this.prisma, codeInsee),
      loadSuccessorMap(this.prisma),
    ]);
    const today = todayInParis();
    const entries = await this.prisma.arreteEntry.findMany({
      where: {
        codeInsee: {
          in: [codeInsee, ...predecessorCodesOf(codeInsee, successorOf)],
        },
        arrete: {
          publishedAt: {
            gte: isoDateToDate(
              resolveDeadline(today, -COMMUNE_ARRETES_WINDOW_MONTHS, 'MONTHS'),
            ),
          },
        },
      },
      select: {
        id: true,
        risque: true,
        eventStart: true,
        eventEnd: true,
        outcome: true,
        arrete: {
          select: { nor: true, publishedAt: true, legifranceUrl: true },
        },
      },
      // `id` only keeps the lines of one arrêté in a stable order: they share
      // its publication date.
      orderBy: [{ arrete: { publishedAt: 'desc' } }, { id: 'asc' }],
    });

    const deadlines = await this.declarationDeadlines(
      entries
        .filter((entry) => entry.outcome === 'RECONNU')
        .map((entry) => dateToIsoDate(entry.arrete.publishedAt)),
      today,
    );

    return {
      commune,
      arretes: entries.map((entry) => {
        const publishedAt = dateToIsoDate(entry.arrete.publishedAt);
        return {
          arreteEntryId: entry.id,
          nor: entry.arrete.nor,
          publishedAt,
          legifranceUrl: entry.arrete.legifranceUrl,
          risqueLabel: entry.risque,
          risques: [...classifyRisques(entry.risque)] as RisqueCatnat[],
          eventStart: dateToIsoDate(entry.eventStart),
          eventEnd: dateToIsoDate(entry.eventEnd),
          outcome: entry.outcome as ArreteEntryOutcome,
          declarationDeadline:
            entry.outcome === 'RECONNU'
              ? (deadlines.get(publishedAt) ?? null)
              : null,
        } satisfies CommuneArrete;
      }),
    };
  }

  /**
   * The deadline of each publication date, resolved once per date rather than
   * once per entry: the entries of one arrêté share its publication, and
   * {@link DeadlineRuleService.resolveDeclaration} is a query.
   *
   * A rule that does not resolve is isolated as `resolveStepRule` isolates
   * it, but reported once per request instead of once per date: the endpoint
   * is public, so a retired rule row would otherwise turn every visitor into
   * a handful of stack-carrying log lines.
   */
  private async declarationDeadlines(
    publishedAts: IsoDate[],
    today: IsoDate,
  ): Promise<Map<IsoDate, DeclarationDeadline | null>> {
    const dates = [...new Set(publishedAts)];
    const settled = await Promise.allSettled(
      dates.map((date) => this.declarationDeadlineAt(date, today)),
    );

    const failed = settled.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    const [first] = failed;
    if (first) {
      this.logger.error(
        `commune arrêtés: DeadlineRule ${DECLARATION_ASSUREUR_CODE} did not resolve for ${failed.length} of ${dates.length} publication dates, those arrêtés listed without a déclaration deadline: ${errorSummary(first.reason)}`,
        stackOf(first.reason),
      );
    }

    return new Map(
      dates.map((date, index) => {
        const result = settled[index];
        return [date, result?.status === 'fulfilled' ? result.value : null];
      }),
    );
  }

  /** The déclaration deadline an arrêté published on this date carries, as
   * {@link declarationDeadlines} isolates it. */
  private async declarationDeadlineAt(
    publishedAt: IsoDate,
    today: IsoDate,
  ): Promise<DeclarationDeadline> {
    const rule = await this.deadlineRules.resolveDeclaration(
      isoDateToDate(publishedAt),
    );
    const date = resolveDeadline(publishedAt, rule.duration, rule.unit);
    return {
      date,
      daysLeft: daysBetween(today, date),
      source: toSourceReference(
        rule.sourceUrl,
        dateToIsoDate(rule.sourceVerifiedAt),
        today,
      ),
    };
  }
}

/** The matched arrêté as the response prints it. */
function arreteOf(match: MatchedArrete): NonNullable<DossierApercu['arrete']> {
  return {
    publishedAt: match.publishedAt,
    legifranceUrl: match.legifranceUrl,
    outcome: match.outcome as ArreteEntryOutcome,
    eventStart: match.eventStart,
    eventEnd: match.eventEnd,
  };
}
