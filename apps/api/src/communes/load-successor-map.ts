import type { PrismaService } from 'src/prisma/prisma.service';

/**
 * `Commune.successorCodeInsee` reduced to a map — only rows that merged carry
 * one, so this is a small fraction of the referential. Shared by
 * `JorfMonitorService` (outbox fan-out, `resolveRecipients`) and
 * `SinistresService.create` (`matchSinistres`, docs/research/sinistre-plan.md,
 * "Привязка entry ↔ синистр") — the second caller made this its own function
 * rather than a second private copy.
 */
export async function loadSuccessorMap(
  prisma: Pick<PrismaService, 'commune'>,
): Promise<Map<string, string>> {
  const rows = await prisma.commune.findMany({
    where: { successorCodeInsee: { not: null } },
    select: { codeInsee: true, successorCodeInsee: true },
  });
  return new Map(
    rows
      .filter(
        (row): row is { codeInsee: string; successorCodeInsee: string } =>
          row.successorCodeInsee !== null,
      )
      .map((row) => [row.codeInsee, row.successorCodeInsee]),
  );
}
