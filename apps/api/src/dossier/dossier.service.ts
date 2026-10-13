import { Injectable, Logger } from '@nestjs/common';
import {
  type ArreteEntryOutcome,
  COMMUNE_ARRETES_WINDOW_MONTHS,
  type CommuneArrete,
  type CommuneArretes,
  type DossierApercu,
} from '@mon-sinistre/contracts';
import { todayInParis } from 'src/common/time/today-in-paris.js';
import { requireActiveCommune } from 'src/communes/active-commune.js';
import { codesMergedInto } from 'src/communes/codes-merged-into.js';
import { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service.js';
import {
  dateToIsoDate,
  isoDateToDate,
  resolveDeadline,
} from 'src/deadline-rules/resolve-deadline.js';
import { classifyRisques } from 'src/jorf/parse/classify-risques.js';
import { PrismaService } from 'src/prisma/prisma.service.js';
import type { CreateSinistreDto } from 'src/sinistres/dto/create-sinistre.dto.js';
import type { MatchedArrete } from 'src/sinistres/match-arrete.js';
import { legalStepDate } from 'src/sinistres/build-step-snapshot.js';
import { planDossier, toPlannedView } from 'src/sinistres/snapshot-plan.js';
import {
  citedSourceOf,
  declarationDeadlineOf,
  toDeclarationDeadline,
  toStepView,
} from 'src/sinistres/to-sinistre-detail.js';

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
    // referential does not know must cost one indexed lookup, not the walk
    // over its predecessors before the 400.
    const codes = await codesMergedInto(this.prisma, codeInsee);
    const today = todayInParis();
    const entries = await this.prisma.arreteEntry.findMany({
      where: {
        codeInsee: { in: codes },
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
      // `nor` keeps the lines of one arrêté together when two arrêtés share
      // a publication date — a rectificatif's line gets a newer `id` than
      // the other arrêté's — and `id` keeps those lines in a stable order.
      orderBy: [
        { arrete: { publishedAt: 'desc' } },
        { arrete: { nor: 'asc' } },
        { id: 'asc' },
      ],
    });

    const ruleFor = await this.deadlineRules.declarationRulesFor(
      entries,
      this.logger,
      'that arrêté listed without a déclaration deadline',
    );

    return {
      commune,
      arretes: entries.map((entry) => {
        const publishedAt = dateToIsoDate(entry.arrete.publishedAt);
        const rule = ruleFor(entry);
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
