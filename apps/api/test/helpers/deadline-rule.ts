import type { StepAnchor } from 'src/generated/prisma/enums';

/** `DECLARATION_ASSUREUR`'s real seed values — the default every override in the test suite starts from, so a schema-only test doesn't have to restate them. */
export function deadlineRuleData(
  overrides: Partial<{
    code: string;
    anchor: StepAnchor;
    duration: number;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }> = {},
) {
  return {
    code: overrides.code ?? 'DECLARATION_ASSUREUR',
    duration: overrides.duration ?? 30,
    unit: 'DAYS' as const,
    anchor: overrides.anchor ?? 'DATE_PUBLICATION_ARRETE',
    effectiveFrom: overrides.effectiveFrom ?? new Date('2023-01-01'),
    effectiveTo:
      overrides.effectiveTo === undefined ? null : overrides.effectiveTo,
    sourceUrl:
      'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006792617/',
    sourceVerifiedAt: new Date('2026-08-18'),
  };
}
