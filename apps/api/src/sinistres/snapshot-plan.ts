import type { Logger } from '@nestjs/common';
import type { Commune, IsoDate, SinistreStatus } from '@mon-sinistre/contracts';
import { todayInParis } from 'src/common/time/today-in-paris.js';
import { requireActiveCommune } from 'src/communes/active-commune.js';
import type { DeadlineRuleService } from 'src/deadline-rules/deadline-rule.service.js';
import { isoDateToDate } from 'src/deadline-rules/resolve-deadline.js';
import type { StepAnchor } from 'src/generated/prisma/enums.js';
import type { PrismaService } from 'src/prisma/prisma.service.js';
import { CATNAT_PLAN_KEY } from 'src/step-templates/step-template.seed.js';
import { anchorDatesOf } from './anchor-dates.js';
import { buildStepSnapshot, type StepSnapshot } from './build-step-snapshot.js';
import type { CreateSinistreDto } from './dto/create-sinistre.dto.js';
import { matchArreteFor, type MatchedArrete } from './match-arrete.js';
import { resolveStepRule } from './resolve-step-rule.js';
import { sinistreStatus } from './sinistre-status.js';
import type { StepViewRow } from './to-sinistre-detail.js';

/** A snapshot as `Step.create` takes it: `plannedDate` in the column's type. */
interface StepCreateRow extends Omit<StepSnapshot, 'plannedDate'> {
  plannedDate: Date | null;
  /** Nothing is marked on a step this fresh. */
  persistedStatus: null;
}

/**
 * One step of a plan that has not been stored — and need not be: the row an
 * insert takes, and the resolved rule a reader needs to print the step
 * ({@link toPlannedView}). The row itself keeps only the rule's id, which
 * only the insert uses.
 */
export interface PlannedStep {
  row: StepCreateRow;
  rule: StepViewRow['deadlineRule'];
}

/** The `CATNAT` plan for a set of anchor dates. */
async function snapshotPlan(
  prisma: Pick<PrismaService, 'stepTemplate'>,
  deadlineRules: DeadlineRuleService,
  anchorDates: Partial<Record<StepAnchor, IsoDate>>,
  today: IsoDate,
  logger: Logger,
): Promise<PlannedStep[]> {
  const templates = await prisma.stepTemplate.findMany({
    where: { planKey: CATNAT_PLAN_KEY },
    orderBy: { order: 'asc' },
  });

  return Promise.all(
    templates.map(async (template) => {
      const rule = await resolveStepRule(
        deadlineRules,
        template,
        anchorDates,
        today,
        logger,
      );
      const snapshot = buildStepSnapshot(template, anchorDates, rule);
      return {
        row: {
          ...snapshot,
          plannedDate: snapshot.plannedDate
            ? isoDateToDate(snapshot.plannedDate)
            : null,
          persistedStatus: null,
        },
        rule:
          rule && template.deadlineRuleCode
            ? {
                code: template.deadlineRuleCode,
                duration: rule.duration,
                unit: rule.unit,
              }
            : null,
      };
    }),
  );
}

export const toPlannedView = ({ row, rule }: PlannedStep): StepViewRow => ({
  ...row,
  deadlineRule: rule,
});

/** Everything the three parameters decide before anything is written. */
export interface PlannedDossier {
  commune: Commune;
  today: IsoDate;
  match: MatchedArrete | null;
  plan: PlannedStep[];
  status: SinistreStatus;
}

/**
 * The whole path from the three parameters to a dated plan, stopping where a
 * sinistre would be written: `SinistresService.create` stores what this
 * returns, `DossierService.apercu` only prints it, and neither owns a formula
 * of its own (docs/research/dossier-preliminaire.md, «Аперçu досье»).
 */
export async function planDossier(
  prisma: Pick<PrismaService, 'stepTemplate' | 'arreteEntry' | 'commune'>,
  deadlineRules: DeadlineRuleService,
  dto: CreateSinistreDto,
  logger: Logger,
): Promise<PlannedDossier> {
  const commune = await requireActiveCommune(prisma, dto.codeInsee);
  const today = todayInParis();
  const match = await matchArreteFor(prisma, dto);
  const plan = await snapshotPlan(
    prisma,
    deadlineRules,
    anchorDatesOf({
      eventDate: dto.eventDate,
      declarationDate: null,
      arretePublishedAt:
        match?.outcome === 'RECONNU' ? match.publishedAt : null,
    }),
    today,
    logger,
  );

  return {
    commune,
    today,
    match,
    plan,
    status: sinistreStatus({
      current: null,
      link: match,
      declarationDate: null,
    }),
  };
}
