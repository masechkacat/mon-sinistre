import { Injectable, Logger } from '@nestjs/common';
import {
  ArreteEntryOutcome,
  type DossierApercu,
} from '@mon-sinistre/contracts';
import { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service';
import { PrismaService } from 'src/prisma/prisma.service';
import type { CreateSinistreDto } from 'src/sinistres/dto/create-sinistre.dto';
import type { MatchedArrete } from 'src/sinistres/match-arrete';
import { planDossier, toPlannedView } from 'src/sinistres/snapshot-plan';
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
