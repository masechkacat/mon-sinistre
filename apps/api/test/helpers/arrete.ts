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
