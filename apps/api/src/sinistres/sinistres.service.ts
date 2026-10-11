import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  SinistreStatus,
  type IsoDate,
  type SinistreConflict,
  type SinistreDetail,
  type SinistreSummary,
  type Step,
} from '@mon-sinistre/contracts';
import type { Prisma } from 'src/generated/prisma/client';
import type { StepPersistedStatus } from 'src/generated/prisma/enums';
import { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service';
import {
  dateToIsoDate,
  isoDateToDate,
} from 'src/deadline-rules/resolve-deadline';
import { fr } from 'src/i18n/fr';
import { PrismaService } from 'src/prisma/prisma.service';
import { todayInParis } from 'src/common/time/today-in-paris';
import type { CreateSinistreDto } from './dto/create-sinistre.dto';
import { recomputeDeclarationSteps } from './recompute-declaration-steps';
import { sinistreStatus } from './sinistre-status';
import { planDossier } from './snapshot-plan';
import { communeFields } from 'src/communes/commune-fields';
import {
  toSinistreDetail,
  toSinistreSummary,
  toStepResponse,
} from './to-sinistre-detail';

const stepInclude = {
  deadlineRule: { select: { code: true, duration: true, unit: true } },
} as const;

/** Everything a `SinistreDetail` read needs. */
const detailInclude = {
  commune: { select: communeFields },
  steps: { orderBy: { order: 'asc' }, include: stepInclude },
} as const;

/** The dossier three parameters name, and whether this call is what wrote it. */
export interface CreatedSinistre {
  sinistre: SinistreDetail;
  created: boolean;
}

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
   *
   * Recognises a dossier the caller already has for this commune and risk —
   * docs/research/dossier-preliminaire.md, «Создание с защитой от двойника».
   * The plan is built before the transaction opens, never inside it: resolving
   * a `DeadlineRule` is a query of its own on another connection, and holding
   * the transaction's while it runs is what `declarationRulesFor`'s docblock
   * warns against.
   */
  async create(
    userId: string,
    dto: CreateSinistreDto,
  ): Promise<CreatedSinistre> {
    const { today, match, plan, status } = await planDossier(
      this.prisma,
      this.deadlineRules,
      dto,
      this.logger,
    );

    return this.prisma.$transaction(async (tx) => {
      const twin = await this.readDetail(tx, {
        userId,
        codeInsee: dto.codeInsee,
        risque: dto.risque,
        eventDate: isoDateToDate(dto.eventDate),
      });
      if (twin) {
        return { sinistre: twin, created: false };
      }
      await this.refuseSecondDate(tx, userId, dto);

      const sinistre = await tx.sinistre.create({
        data: {
          userId,
          codeInsee: dto.codeInsee,
          risque: dto.risque,
          eventDate: isoDateToDate(dto.eventDate),
          declarationDate: null,
          arreteEntryId: match?.arreteEntryId ?? null,
          status,
          steps: { create: plan.map((step) => step.row) },
        },
        include: detailInclude,
      });

      return {
        sinistre: toSinistreDetail(sinistre, sinistre.steps, today),
        created: true,
      };
    });
  }

  /**
   * Asks the caller to confirm a second dossier of this commune and risk
   * under another date, or lets the creation through. Two such dossiers are
   * legitimate (a second home, a second event), so the answer is a question
   * rather than a refusal.
   */
  private async refuseSecondDate(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: CreateSinistreDto,
  ): Promise<void> {
    if (dto.confirmNew === true) {
      return;
    }
    // Freshest of them: the dossier opened last is the one the question is
    // most likely to be about.
    const other = await tx.sinistre.findFirst({
      where: { userId, codeInsee: dto.codeInsee, risque: dto.risque },
      orderBy: { createdAt: 'desc' },
      select: { id: true, eventDate: true },
    });
    if (other) {
      throw new ConflictException({
        code: 'DOSSIER_EXISTANT',
        existing: { id: other.id, eventDate: dateToIsoDate(other.eventDate) },
      } satisfies SinistreConflict);
    }
  }

  /** Ownership is part of the `where`, not checked after the fact — a chosen
   * and a nonexistent sinistre answer the same 404 (`apps/api/CLAUDE.md`). */
  async findOne(userId: string, id: string): Promise<SinistreDetail> {
    const sinistre = await this.readDetail(this.prisma, { id, userId });
    if (!sinistre) {
      throw new NotFoundException();
    }
    return sinistre;
  }

  /** The one read behind every stored `SinistreDetail` this service answers
   * with; `where` carries the ownership condition of its caller. */
  private async readDetail(
    tx: Prisma.TransactionClient,
    where: Prisma.SinistreWhereInput,
  ): Promise<SinistreDetail | null> {
    const sinistre = await tx.sinistre.findFirst({
      where,
      include: detailInclude,
    });
    return (
      sinistre && toSinistreDetail(sinistre, sinistre.steps, todayInParis())
    );
  }

  /** Freshest first — a returning user's most recent dossier is what they
   * came back to check on. */
  async findAll(userId: string): Promise<SinistreSummary[]> {
    const sinistres = await this.prisma.sinistre.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { commune: { select: communeFields } },
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
        include: { arreteEntry: { include: { arrete: true } } },
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

      await recomputeDeclarationSteps(tx, id, {
        eventDate,
        declarationDate,
        arretePublishedAt,
      });

      const updated = await tx.sinistre.findUniqueOrThrow({
        where: { id },
        include: detailInclude,
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
        include: stepInclude,
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
        include: stepInclude,
      });
      return toStepResponse(step, today);
    });
  }
}
