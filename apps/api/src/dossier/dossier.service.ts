import { Injectable, Logger } from '@nestjs/common';
import {
  type ArreteEntryOutcome,
  COMMUNE_ARRETES_WINDOW_MONTHS,
  type CommuneArrete,
  type CommuneArretes,
  type DossierApercu,
} from '@mon-sinistre/contracts';
import { todayInParis } from 'src/common/time/today-in-paris';
import { requireActiveCommune } from 'src/communes/active-commune';
import { loadSuccessorMap } from 'src/communes/load-successor-map';
import { predecessorCodesOf } from 'src/communes/predecessor-codes';
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
import { legalStepDate } from 'src/sinistres/build-step-snapshot';
import { planDossier, toPlannedView } from 'src/sinistres/snapshot-plan';
import {
  citedSourceOf,
  declarationDeadlineOf,
  toDeclarationDeadline,
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
    const commune = await requireActiveCommune(this.prisma, codeInsee);
    // Sequential, not `Promise.all`: the endpoint is public, and a code the
    // referential does not know must cost one indexed lookup, not the whole
    // merged-communes table read before the 400.
    const successorOf = await loadSuccessorMap(this.prisma);
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

    const ruleByPublishedAt = await this.deadlineRules.resolveDeclarationByDate(
      entries
        .filter((entry) => entry.outcome === 'RECONNU')
        .map((entry) => dateToIsoDate(entry.arrete.publishedAt)),
      this.logger,
      'that arrêté listed without a déclaration deadline',
    );

    return {
      commune,
      arretes: entries.map((entry) => {
        const publishedAt = dateToIsoDate(entry.arrete.publishedAt);
        const rule =
          entry.outcome === 'RECONNU'
            ? ruleByPublishedAt.get(publishedAt)
            : null;
        return {
          arreteEntryId: entry.id,
          nor: entry.arrete.nor,
          publishedAt,
          legifranceUrl: entry.arrete.legifranceUrl,
          risqueLabel: entry.risque,
          risques: [...classifyRisques(entry.risque)],
          eventStart: dateToIsoDate(entry.eventStart),
          eventEnd: dateToIsoDate(entry.eventEnd),
          outcome: entry.outcome as ArreteEntryOutcome,
          declarationDeadline: rule
            ? toDeclarationDeadline(
                legalStepDate(publishedAt, rule),
                citedSourceOf(rule, today),
                today,
              )
            : null,
        } satisfies CommuneArrete;
      }),
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
