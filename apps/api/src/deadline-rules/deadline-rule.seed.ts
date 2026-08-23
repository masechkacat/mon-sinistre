import { PrismaClient } from 'src/generated/prisma/client';

/** The one spelling of the déclaration-délai `DeadlineRule.code` — the seed
 * row and every lookup of it (`src/jorf/jorf-monitor.service.ts`) key on this
 * constant, not a repeated string literal. */
export const DECLARATION_ASSUREUR_CODE = 'DECLARATION_ASSUREUR';

/**
 * The five post-declaration insurer-deadline codes — docs/research/
 * sinistre-plan.md, «Сроки страховщика после декларации». `src/step-templates/
 * step-template.seed.ts` references them by these constants, not by literal.
 */
export const INFORMATION_ASSUREUR_CODE = 'INFORMATION_ASSUREUR';
export const PROVISION_INDEMNITE_CODE = 'PROVISION_INDEMNITE';
export const PROPOSITION_INDEMNISATION_CODE = 'PROPOSITION_INDEMNISATION';
export const REPARATION_MISSIONNEE_CODE = 'REPARATION_MISSIONNEE';
export const VERSEMENT_INDEMNITE_CODE = 'VERSEMENT_INDEMNITE';

const ARTICLE_L125_2_URL =
  'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006792617/';

/**
 * Every legal deadline the app relies on lives here with its source — no
 * hard-coded legal numbers elsewhere (ТЗ § 7). Values verified against the
 * source article — docs/research/jorf-monitor.md, «DeadlineRule: срок
 * déclaration», docs/research/sinistre-plan.md, «Сроки страховщика после
 * декларации» for the five rows below `DECLARATION_ASSUREUR`.
 */
export const DEADLINE_RULE_SEED = [
  {
    code: DECLARATION_ASSUREUR_CODE,
    duration: 30,
    unit: 'DAYS' as const,
    anchor: 'DATE_PUBLICATION_ARRETE' as const,
    effectiveFrom: new Date('2023-01-01'),
    sourceUrl: ARTICLE_L125_2_URL,
    sourceVerifiedAt: new Date('2026-08-18'),
  },
  {
    code: INFORMATION_ASSUREUR_CODE,
    duration: 1,
    unit: 'MONTHS' as const,
    anchor: 'DATE_DECLARATION' as const,
    // «un mois pour informer» is worded the same since the 2023-01-01
    // edition — the earlier one (17.08.2004 → 01.01.2023) still names
    // "trois mois" for indemnisation instead (research, same section).
    effectiveFrom: new Date('2023-01-01'),
    sourceUrl: ARTICLE_L125_2_URL,
    sourceVerifiedAt: new Date('2026-08-23'),
  },
  {
    code: PROVISION_INDEMNITE_CODE,
    duration: 2,
    unit: 'MONTHS' as const,
    anchor: 'DATE_ETAT_ESTIMATIF' as const,
    // Only the edition in force since 28.05.2026 (LOI n° 2026-403, art. 33)
    // was checked word for word for this wording — research, same section.
    effectiveFrom: new Date('2026-05-28'),
    sourceUrl: ARTICLE_L125_2_URL,
    sourceVerifiedAt: new Date('2026-08-23'),
  },
  {
    code: PROPOSITION_INDEMNISATION_CODE,
    duration: 1,
    unit: 'MONTHS' as const,
    anchor: 'DATE_ETAT_ESTIMATIF_OU_EXPERTISE' as const,
    effectiveFrom: new Date('2026-05-28'),
    sourceUrl: ARTICLE_L125_2_URL,
    sourceVerifiedAt: new Date('2026-08-23'),
  },
  {
    code: REPARATION_MISSIONNEE_CODE,
    duration: 1,
    unit: 'MONTHS' as const,
    anchor: 'DATE_ACCORD_INDEMNISATION' as const,
    effectiveFrom: new Date('2026-05-28'),
    sourceUrl: ARTICLE_L125_2_URL,
    sourceVerifiedAt: new Date('2026-08-23'),
  },
  {
    code: VERSEMENT_INDEMNITE_CODE,
    duration: 21,
    unit: 'DAYS' as const,
    anchor: 'DATE_ACCORD_INDEMNISATION' as const,
    effectiveFrom: new Date('2026-05-28'),
    sourceUrl: ARTICLE_L125_2_URL,
    sourceVerifiedAt: new Date('2026-08-23'),
  },
];

// Upsert по (code, effectiveFrom) — тому же ключу, что unique-ограничение
// схемы: повторный прогон seed не создаёт вторую строку.
export async function seedDeadlineRules(prisma: PrismaClient): Promise<void> {
  for (const rule of DEADLINE_RULE_SEED) {
    await prisma.deadlineRule.upsert({
      where: {
        code_effectiveFrom: {
          code: rule.code,
          effectiveFrom: rule.effectiveFrom,
        },
      },
      create: rule,
      update: rule,
    });
  }
}
