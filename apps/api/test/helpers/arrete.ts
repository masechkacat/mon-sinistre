import { RisqueCatnat, toIsoDate } from '@mon-sinistre/contracts';

/**
 * The single arrêté the e2e seed publishes (`e2e-referential.ts`), named here
 * rather than there because this file imports no `src/` module: the
 * Playwright spec of `apps/web` reads the dates it asserts from the same
 * place the seed writes them. The publication date is the seed's, counted
 * from the run.
 */
export const E2E_ARRETE = {
  nor: 'INTE2609999A',
  codeInsee: '13055',
  communeLabelRaw: 'Marseille',
  departementRaw: 'Bouches-du-Rhône',
  /** As the Journal officiel prints it, and the category it classifies to. */
  risqueLabel: 'Inondations et coulées de boue',
  risque: RisqueCatnat.INONDATION,
  eventStart: toIsoDate('2026-09-28'),
  eventEnd: toIsoDate('2026-10-02'),
} as const;

/** Minimal `Arrete` row good enough for schema-level int-specs. */
export function arreteData(overrides: Partial<{ nor: string }> = {}) {
  return {
    nor: overrides.nor ?? `INTE${Math.random()}`,
    signedAt: new Date('2026-06-10'),
    publishedAt: new Date('2026-06-12'),
    jorfNumber: 'JORF n°0137 du 13 juin 2026',
    legifranceUrl:
      'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054245373',
    firstSeenAt: new Date('2026-06-13T06:00:00Z'),
    lastSeenAt: new Date('2026-06-13T06:00:00Z'),
    contentHash: 'hash-1',
  };
}

/** Minimal `ArreteEntry` row for nesting under `arreteData()` via `entries.create`.
 * `codeInsee` is a parameter, not an override: omitted, it would build an entry
 * with no commune (`docs/research/data-model.md` § 4, `ArreteEntry`). */
export function arreteEntryData(
  codeInsee: string,
  overrides: Partial<{
    communeLabelRaw: string;
    departementRaw: string;
    risque: string;
    eventStart: Date;
    eventEnd: Date;
    outcome: 'RECONNU' | 'REFUSE';
    motivation: string | null;
  }> = {},
) {
  return {
    codeInsee,
    communeLabelRaw: overrides.communeLabelRaw ?? 'Nîmes',
    departementRaw: overrides.departementRaw ?? 'Gard',
    risque: overrides.risque ?? 'Inondations',
    eventStart: overrides.eventStart ?? new Date('2026-06-01'),
    eventEnd: overrides.eventEnd ?? new Date('2026-06-20'),
    outcome: overrides.outcome ?? ('RECONNU' as const),
    motivation: overrides.motivation ?? null,
  };
}
