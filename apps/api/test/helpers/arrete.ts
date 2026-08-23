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

/** Minimal `ArreteEntry` row for nesting under `arreteData()` via `entries.create`. */
export function arreteEntryData(
  overrides: Partial<{
    codeInsee: string;
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
    codeInsee: overrides.codeInsee as string,
    communeLabelRaw: overrides.communeLabelRaw ?? 'Nîmes',
    departementRaw: overrides.departementRaw ?? 'Gard',
    risque: overrides.risque ?? 'Inondations',
    eventStart: overrides.eventStart ?? new Date('2026-06-01'),
    eventEnd: overrides.eventEnd ?? new Date('2026-06-20'),
    outcome: overrides.outcome ?? ('RECONNU' as const),
    motivation: overrides.motivation ?? null,
  };
}
