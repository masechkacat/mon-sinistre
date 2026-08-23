import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  SinistreStatus,
  type IsoDate,
  type SinistreDetail,
  type SinistreSummary,
  type Step,
} from '@mon-sinistre/contracts';
import type {
  ArreteEntryOutcome,
  StepAnchor,
  StepPersistedStatus,
} from 'src/generated/prisma/enums';
import { errorSummary, stackOf } from 'src/common/error-report';
import { loadSuccessorMap } from 'src/communes/load-successor-map';
import { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service';
import {
  dateToIsoDate,
  isoDateToDate,
} from 'src/deadline-rules/resolve-deadline';
import { fr } from 'src/i18n/fr';
import { PrismaService } from 'src/prisma/prisma.service';
import { todayInParis } from 'src/common/time/today-in-paris';
import { anchorDatesOf } from './anchor-dates';
import {
  buildStepSnapshot,
  resolveStepPlannedDate,
  type ResolvedDeadlineRule,
  type StepTemplateRow,
} from './build-step-snapshot';
import type { CreateSinistreDto } from './dto/create-sinistre.dto';
import { matchSinistres } from './match-sinistres';
import { CATNAT_PLAN_KEY } from 'src/step-templates/step-template.seed';
import { sinistreStatus } from './sinistre-status';
import {
  toSinistreDetail,
  toSinistreSummary,
  toStepResponse,
} from './to-sinistre-detail';

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
   *
   * Matches against already-ingested arrêtés before building the plan
   * (docs/research/sinistre-plan.md, «Привязка entry ↔ синистр») — a
   * dossier opened off a notification letter, after the monitor already
   * found the arrêté, must not wait for the next arrêté to get its
   * deadline. A `RECONNU` match dates the `DATE_PUBLICATION_ARRETE` step
   * off the real publication date, not today's; a `REFUSE` match only sets
   * `arreteEntryId` and the status — no déclaration deadline exists to
   * date (critère PRD № 6).
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
    const match = await this.matchArrete(dto);
    const anchorDates = anchorDatesOf({
      eventDate: dto.eventDate,
      declarationDate: null,
      arretePublishedAt:
        match?.outcome === 'RECONNU' ? match.publishedAt : null,
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
        arreteEntryId: match?.arreteEntryId ?? null,
        status: sinistreStatus({
          current: null,
          link: match ? { outcome: match.outcome } : null,
          declarationDate: null,
        }),
        steps: { create: steps },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    return toSinistreDetail(sinistre, sinistre.steps, today);
  }

  /**
   * Matches a not-yet-created sinistre against already-ingested arrêtés
   * through the shared pure `matchSinistres` (`src/sinistres/match-sinistres.ts`)
   * — the same function the monitor's own linking pass
   * (docs/plan/sinistre-plan.md, Фаза 3) will call for already-created
   * dossiers, so the two never disagree on what counts as a match. The
   * candidate carries a placeholder id: `matchSinistres` only echoes it
   * back on the `Link` it returns, and this caller has exactly one
   * candidate, so the id itself is never read.
   */
  private async matchArrete(dto: CreateSinistreDto): Promise<{
    arreteEntryId: string;
    outcome: ArreteEntryOutcome;
    publishedAt: IsoDate;
  } | null> {
    const eventDate = isoDateToDate(dto.eventDate);
    const [entries, successorOf] = await Promise.all([
      this.prisma.arreteEntry.findMany({
        where: {
          codeInsee: { not: null },
          eventStart: { lte: eventDate },
          eventEnd: { gte: eventDate },
        },
        select: {
          id: true,
          codeInsee: true,
          risque: true,
          eventStart: true,
          eventEnd: true,
          outcome: true,
          arrete: { select: { publishedAt: true } },
        },
      }),
      loadSuccessorMap(this.prisma),
    ]);

    const links = matchSinistres(
      entries.map((entry) => ({
        id: entry.id,
        codeInsee: entry.codeInsee,
        risque: entry.risque,
        eventStart: dateToIsoDate(entry.eventStart),
        eventEnd: dateToIsoDate(entry.eventEnd),
        outcome: entry.outcome,
        publishedAt: dateToIsoDate(entry.arrete.publishedAt),
      })),
      [
        {
          id: 'candidate',
          codeInsee: dto.codeInsee,
          risque: dto.risque,
          eventDate: dto.eventDate,
        },
      ],
      successorOf,
    );
    const arreteEntryId = links[0]?.arreteEntryId;
    if (!arreteEntryId) {
      return null;
    }
    const entry = entries.find((e) => e.id === arreteEntryId);
    if (!entry) {
      return null;
    }
    return {
      arreteEntryId,
      outcome: entry.outcome,
      publishedAt: dateToIsoDate(entry.arrete.publishedAt),
    };
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

  /** Freshest first — a returning user's most recent dossier is what they
   * came back to check on. */
  async findAll(userId: string): Promise<SinistreSummary[]> {
    const sinistres = await this.prisma.sinistre.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return sinistres.map(toSinistreSummary);
  }

  /**
   * Sets or clears `declarationDate`. `sinistreStatus` is the only place a
   * status is decided (docs/research/sinistre-plan.md, «Контракт API»), and
   * the `DATE_DECLARATION` steps' `plannedDate` is recomputed off the same
   * anchor — set on a date, cleared back to null when the date is cleared
   * and nothing else resolves it. Same reason for the transaction as {@link
   * updateStep}: a concurrent second write landing between the read and the
   * writes below must not hand this request back a status or a step date it
   * never wrote.
   */
  async update(
    userId: string,
    id: string,
    declarationDate: IsoDate | null,
  ): Promise<SinistreDetail> {
    return this.prisma.$transaction(async (tx) => {
      const sinistre = await tx.sinistre.findFirst({
        where: { id, userId },
        include: {
          steps: {
            orderBy: { order: 'asc' },
            include: { deadlineRule: true },
          },
          arreteEntry: { include: { arrete: true } },
        },
      });
      if (!sinistre) {
        throw new NotFoundException();
      }

      const eventDate = dateToIsoDate(sinistre.eventDate);
      if (declarationDate !== null && declarationDate < eventDate) {
        throw new BadRequestException(fr.sinistres.declarationDateBeforeEvent);
      }

      const arretePublishedAt = sinistre.arreteEntry
        ? dateToIsoDate(sinistre.arreteEntry.arrete.publishedAt)
        : null;
      const declarationAnchorDate = anchorDatesOf({
        eventDate,
        declarationDate,
        arretePublishedAt,
      }).DATE_DECLARATION;
      const status = sinistreStatus({
        current: sinistre.status as SinistreStatus,
        link: sinistre.arreteEntry
          ? { outcome: sinistre.arreteEntry.outcome }
          : null,
        declarationDate,
      });

      await tx.sinistre.update({
        where: { id },
        data: {
          declarationDate: declarationDate
            ? isoDateToDate(declarationDate)
            : null,
          status,
        },
      });

      for (const step of sinistre.steps) {
        // `fromTemplate` does not follow from `anchor`: a user-added step is
        // left anchorless by convention, not by the schema (root `CLAUDE.md`).
        if (step.anchor !== 'DATE_DECLARATION' || !step.fromTemplate) {
          continue;
        }
        const plannedDate = resolveStepPlannedDate(
          declarationAnchorDate,
          step.deadlineRuleId !== null,
          step.deadlineRule,
          step.offsetDays,
        );
        await tx.step.update({
          where: { id: step.id },
          data: {
            plannedDate: plannedDate ? isoDateToDate(plannedDate) : null,
          },
        });
      }

      const updated = await tx.sinistre.findUniqueOrThrow({
        where: { id },
        include: { steps: { orderBy: { order: 'asc' } } },
      });
      return toSinistreDetail(updated, updated.steps, todayInParis());
    });
  }

  /** Ownership check same as {@link findOne}. `deleteMany` rather than
   * read-then-delete keeps that check inside the one query; its steps
   * cascade by schema (`onDelete: Cascade`). */
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.sinistre.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw new NotFoundException();
    }
  }

  /** `completedAt` follows `status`: set on mark (FAIT or NON_APPLICABLE
   * alike), cleared on unmark. Ownership in the read and the idempotent
   * re-mark — docs/research/sinistre-plan.md, «Контракт API». The read and
   * the write share a transaction for the same reason as
   * `AuthService.refresh`'s rotation: a second concurrent PATCH landing
   * between them could hand this request back a status it never wrote. */
  async updateStep(
    userId: string,
    sinistreId: string,
    stepId: string,
    status: StepPersistedStatus | null,
  ): Promise<Step> {
    const today = todayInParis();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.step.findFirst({
        where: { id: stepId, sinistre: { id: sinistreId, userId } },
      });
      if (!current) {
        throw new NotFoundException();
      }
      if (current.persistedStatus === status) {
        return toStepResponse(current, today);
      }
      const step = await tx.step.update({
        where: { id: stepId },
        data: {
          persistedStatus: status,
          completedAt: status ? isoDateToDate(today) : null,
        },
      });
      return toStepResponse(step, today);
    });
  }
}
