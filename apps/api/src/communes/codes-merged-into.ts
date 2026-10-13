import { resolveCurrentCode } from 'src/jorf/recipients/resolve-recipients.js';
import type { PrismaService } from 'src/prisma/prisma.service.js';

/**
 * `code` and every commune merged into it, however many mergers back
 * (docs/research/dossier-preliminaire.md, "Ответ по коммуне"): the successor
 * edges leading to `code`, one query per hop (data-model.md § 3), filtered by
 * the forward `resolveCurrentCode` — a cycle or an overlong chain counts here
 * as it does there.
 */
export async function codesMergedInto(
  prisma: Pick<PrismaService, 'commune'>,
  code: string,
): Promise<string[]> {
  const successorOf = new Map<string, string>();
  let frontier = [code];
  while (frontier.length > 0) {
    const rows = await prisma.commune.findMany({
      where: { successorCodeInsee: { in: frontier } },
      select: { codeInsee: true, successorCodeInsee: true },
    });
    frontier = [];
    for (const { codeInsee, successorCodeInsee } of rows) {
      if (successorCodeInsee !== null && !successorOf.has(codeInsee)) {
        successorOf.set(codeInsee, successorCodeInsee);
        frontier.push(codeInsee);
      }
    }
  }
  return [
    code,
    ...[...successorOf.keys()].filter(
      (predecessor) => resolveCurrentCode(predecessor, successorOf) === code,
    ),
  ];
}
