import {
  DECLARATION_ASSUREUR_CODE,
  INFORMATION_ASSUREUR_CODE,
  PROPOSITION_INDEMNISATION_CODE,
  PROVISION_INDEMNITE_CODE,
  REPARATION_MISSIONNEE_CODE,
  VERSEMENT_INDEMNITE_CODE,
} from 'src/deadline-rules/deadline-rule.seed';
import { PrismaClient } from 'src/generated/prisma/client';

/** The only `StepTemplate.planKey` this MVP seeds — `CATNAT_REFUS` (refusal
 * steps) is out of PRD scope (docs/research/sinistre-plan.md, «Шаблон
 * плана»). */
export const CATNAT_PLAN_KEY = 'CATNAT';

/**
 * The thirteen-step CATNAT plan — docs/research/sinistre-plan.md, «Шаблон
 * плана». French copy lives in the database, not `fr.ts`: a sinistre
 * snapshots the template at creation, and a locale-file edit would silently
 * rewrite already-created dossiers' text. Every row carries either
 * `offsetDays` (a product step, no legal number), `deadlineRuleCode` (its
 * duration lives in `DeadlineRule`), or neither (a reminder with no date
 * yet) — never a legal number in the text itself (ТЗ § 7).
 */
export const STEP_TEMPLATE_SEED = [
  {
    order: 1,
    name: 'Photographier et filmer les dégâts',
    description:
      "Avant tout nettoyage, photographiez et filmez l'ensemble des dégâts, pièce par pièce et objet par objet : cette preuve est la base de votre dossier.",
    anchor: 'DATE_SINISTRE' as const,
    offsetDays: 0,
    deadlineRuleCode: null,
  },
  {
    order: 2,
    name: "Ne rien jeter avant le passage de l'expert",
    description:
      "Conservez tous les objets et matériaux endommagés, même hors d'usage : l'expert de l'assurance doit pouvoir les examiner.",
    anchor: 'DATE_SINISTRE' as const,
    offsetDays: 0,
    deadlineRuleCode: null,
  },
  {
    order: 3,
    name: "Limiter l'aggravation des dégâts",
    description:
      "Prenez les mesures d'urgence nécessaires pour éviter que les dégâts empirent (bâcher une toiture, couper l'électricité...) et conservez les factures de ces mesures.",
    anchor: 'DATE_SINISTRE' as const,
    offsetDays: 1,
    deadlineRuleCode: null,
  },
  {
    order: 4,
    name: 'Prévenir votre assureur',
    description:
      "Contactez votre assureur pour l'informer du sinistre, même avant la publication de l'arrêté : cette pré-déclaration accélère la suite du dossier.",
    anchor: 'DATE_SINISTRE' as const,
    offsetDays: 1,
    deadlineRuleCode: null,
  },
  {
    order: 5,
    name: 'Rassembler les factures et justificatifs',
    description:
      "Retrouvez les factures, tickets de caisse et autres justificatifs d'achat des biens endommagés : ils appuient votre demande d'indemnisation.",
    anchor: 'DATE_SINISTRE' as const,
    offsetDays: 3,
    deadlineRuleCode: null,
  },
  {
    order: 6,
    name: 'Vérifier la demande de reconnaissance en mairie',
    description:
      "Assurez-vous auprès de votre mairie qu'elle a bien déposé la demande de reconnaissance de l'état de catastrophe naturelle pour votre commune.",
    anchor: 'DATE_SINISTRE' as const,
    offsetDays: 7,
    deadlineRuleCode: null,
  },
  {
    order: 7,
    name: 'Déclarer le sinistre à votre assureur',
    description:
      "Une fois l'arrêté publié, déclarez officiellement le sinistre à votre assureur : c'est ce qui déclenche les délais légaux d'indemnisation.",
    anchor: 'DATE_PUBLICATION_ARRETE' as const,
    offsetDays: null,
    deadlineRuleCode: DECLARATION_ASSUREUR_CODE,
  },
  {
    order: 8,
    name: "L'assureur précise la procédure",
    description:
      'Votre assureur doit vous indiquer les modalités de mise en jeu de vos garanties et, si besoin, désigner un expert.',
    anchor: 'DATE_DECLARATION' as const,
    offsetDays: null,
    deadlineRuleCode: INFORMATION_ASSUREUR_CODE,
  },
  {
    order: 9,
    name: "Transmettre l'état estimatif des dégâts",
    description:
      "Préparez et transmettez à votre assureur l'état estimatif de vos pertes, avec l'appui de vos photos et justificatifs.",
    anchor: 'DATE_DECLARATION' as const,
    offsetDays: null,
    deadlineRuleCode: null,
  },
  {
    order: 10,
    name: 'Provision sur indemnité',
    description:
      "Votre assureur doit vous verser une provision sur l'indemnisation à venir.",
    anchor: 'DATE_ETAT_ESTIMATIF' as const,
    offsetDays: null,
    deadlineRuleCode: PROVISION_INDEMNITE_CODE,
  },
  {
    order: 11,
    name: "Proposition d'indemnisation",
    description:
      "Votre assureur doit vous faire une proposition d'indemnisation, sur la base de l'état estimatif ou du rapport d'expertise.",
    anchor: 'DATE_ETAT_ESTIMATIF_OU_EXPERTISE' as const,
    offsetDays: null,
    deadlineRuleCode: PROPOSITION_INDEMNISATION_CODE,
  },
  {
    order: 12,
    name: "L'entreprise de réparation est missionnée",
    description:
      'Une fois votre accord donné sur la proposition, votre assureur doit mandater une entreprise pour effectuer les réparations.',
    anchor: 'DATE_ACCORD_INDEMNISATION' as const,
    offsetDays: null,
    deadlineRuleCode: REPARATION_MISSIONNEE_CODE,
  },
  {
    order: 13,
    name: "Versement de l'indemnisation",
    description:
      "Votre assureur doit vous verser l'indemnisation due, une fois votre accord donné sur la proposition.",
    anchor: 'DATE_ACCORD_INDEMNISATION' as const,
    offsetDays: null,
    deadlineRuleCode: VERSEMENT_INDEMNITE_CODE,
  },
];

// Upsert by (planKey, order) — the same key the schema's unique index
// enforces — so a repeated run edits rows in place instead of duplicating
// them.
export async function seedStepTemplates(prisma: PrismaClient): Promise<void> {
  for (const step of STEP_TEMPLATE_SEED) {
    const data = {
      planKey: CATNAT_PLAN_KEY,
      required: true,
      ...step,
    };
    await prisma.stepTemplate.upsert({
      where: {
        planKey_order: { planKey: CATNAT_PLAN_KEY, order: step.order },
      },
      create: data,
      update: data,
    });
  }
}
