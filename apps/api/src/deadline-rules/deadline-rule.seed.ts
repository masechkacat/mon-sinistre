import { PrismaClient } from 'src/generated/prisma/client';

/** The one spelling of the déclaration-délai `DeadlineRule.code` — the seed
 * row and every lookup of it (`src/jorf/jorf-monitor.service.ts`) key on this
 * constant, not a repeated string literal. */
export const DECLARATION_ASSUREUR_CODE = 'DECLARATION_ASSUREUR';

/**
 * Every legal deadline the app relies on lives here with its source — no
 * hard-coded legal numbers elsewhere (ТЗ § 7). Values verified against the
 * source article — docs/research/jorf-monitor.md, «DeadlineRule: срок
 * déclaration».
 */
export const DEADLINE_RULE_SEED = [
  {
    code: DECLARATION_ASSUREUR_CODE,
    duration: 30,
    unit: 'DAYS' as const,
    anchor: 'DATE_PUBLICATION_ARRETE' as const,
    effectiveFrom: new Date('2023-01-01'),
    sourceUrl:
      'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006792617/',
    sourceVerifiedAt: new Date('2026-08-18'),
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
