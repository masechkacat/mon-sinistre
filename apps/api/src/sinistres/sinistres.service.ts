import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { IsoDate, SinistreDetail } from '@mon-sinistre/contracts';
import type { StepAnchor } from 'src/generated/prisma/enums';
import { errorSummary, stackOf } from 'src/common/error-report';
import { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service';
import { isoDateToDate } from 'src/deadline-rules/resolve-deadline';
import { fr } from 'src/i18n/fr';
import { PrismaService } from 'src/prisma/prisma.service';
import { todayInParis } from 'src/common/time/today-in-paris';
import { anchorDatesOf } from './anchor-dates';
import {
  buildStepSnapshot,
  type ResolvedDeadlineRule,
  type StepTemplateRow,
} from './build-step-snapshot';
import type { CreateSinistreDto } from './dto/create-sinistre.dto';
import { CATNAT_PLAN_KEY } from 'src/step-templates/step-template.seed';
import { toSinistreDetail } from './to-sinistre-detail';

@Injectable()
export class SinistresService {
  private readonly logger = new Logger(SinistresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deadlineRules: DeadlineRuleService,
  ) {}

  /**
   * Snapshots the `CATNAT` `StepTemplate` plan onto a fresh `Sinistre`
   * (docs/research/sinistre-plan.md, «Шаблон плана»). A step whose
   * `deadlineRuleCode` anchor has not resolved yet still gets its rule
   * resolved — on the sinistre's creation date rather than the anchor's —
   * so it can cite a source even without a `plannedDate`
   * (research, «Как применять»).
   */
  async create(
    userId: string,
    dto: CreateSinistreDto,
  ): Promise<SinistreDetail> {
    const commune = await this.prisma.commune.findFirst({
      where: { codeInsee: dto.codeInsee, effectiveTo: null },
      select: { codeInsee: true },
    });
    if (!commune) {
      throw new BadRequestException(fr.sinistres.unknownCommune);
    }

    const today = todayInParis();
    const anchorDates = anchorDatesOf({
      eventDate: dto.eventDate,
      declarationDate: null,
      arretePublishedAt: null,
    });

    const templates = await this.prisma.stepTemplate.findMany({
      where: { planKey: CATNAT_PLAN_KEY },
      orderBy: { order: 'asc' },
    });

    const steps = await Promise.all(
      templates.map(async (template) => {
        const rule = await this.resolveRule(template, anchorDates, today);
        const snapshot = buildStepSnapshot(template, anchorDates, rule);
        return {
          ...snapshot,
          plannedDate: snapshot.plannedDate
            ? isoDateToDate(snapshot.plannedDate)
            : null,
        };
      }),
    );

    const sinistre = await this.prisma.sinistre.create({
      data: {
        userId,
        codeInsee: dto.codeInsee,
        risque: dto.risque,
        eventDate: isoDateToDate(dto.eventDate),
        declarationDate: null,
        status: 'AVANT_ARRETE',
        steps: { create: steps },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    return toSinistreDetail(sinistre, sinistre.steps, today);
  }

  /**
   * A step whose rule does not resolve is snapshotted without one, the way
   * `JorfMonitorService.drainOutbox` isolates its own call: {@link
   * DeadlineRuleService.resolveActive} throws by design, and a gap in the
   * referential must not cost the whole dossier — the `DATE_SINISTRE` steps
   * and the déclaration deadline are what the user came for on day one. The
   * step keeps no date and no source rather than an unconfirmed one (ТЗ § 7).
   */
  private async resolveRule(
    template: StepTemplateRow,
    anchorDates: Partial<Record<StepAnchor, IsoDate>>,
    today: IsoDate,
  ): Promise<ResolvedDeadlineRule | null> {
    if (!template.deadlineRuleCode) {
      return null;
    }
    try {
      return await this.deadlineRules.resolveActive(
        template.deadlineRuleCode,
        template.anchor,
        isoDateToDate(anchorDates[template.anchor] ?? today),
      );
    } catch (error) {
      this.logger.error(
        `sinistre plan: DeadlineRule ${template.deadlineRuleCode} on ${template.anchor} did not resolve, step created without a deadline: ${errorSummary(error)}`,
        stackOf(error),
      );
      return null;
    }
  }

  /** Ownership is part of the `where`, not checked after the fact — a chosen
   * and a nonexistent sinistre answer the same 404 (`apps/api/CLAUDE.md`). */
  async findOne(userId: string, id: string): Promise<SinistreDetail> {
    const sinistre = await this.prisma.sinistre.findFirst({
      where: { id, userId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!sinistre) {
      throw new NotFoundException();
    }
    return toSinistreDetail(sinistre, sinistre.steps, todayInParis());
  }
}
