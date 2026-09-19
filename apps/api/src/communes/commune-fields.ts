/**
 * Prisma projection of the wire {@link Commune}. Spelled out rather than
 * selecting the whole row: the referential also carries its source URL,
 * successor and validity dates, and a caller that hands its rows straight to
 * a response would ship those to the client.
 */
export const communeFields = {
  codeInsee: true,
  name: true,
  departementCode: true,
  departementName: true,
} as const;
