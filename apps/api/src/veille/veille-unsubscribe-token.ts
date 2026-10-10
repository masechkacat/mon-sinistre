import type { Prisma } from 'src/generated/prisma/client';
import { nullIfRecordNotFound } from 'src/prisma/prisma-error';
import { generateVeilleToken } from './veille-token';

export type MintedUnsubscribeToken = {
  email: string;
  unsubscribeToken: string;
};

/**
 * The one place a mail to a confirmed subscription gets its unsubscribe
 * token: a `VeilleUnsubscribeToken` row per mail, all of them valid
 * (data-model § 6), written on whatever client the caller hands over so a
 * caller with a transaction of its own keeps the mint inside it. `null`
 * means the row is gone (cascaded away by a desinscription) or not
 * confirmed — Veille never reverts `confirmedAt` once set (CLAUDE.md,
 * «Жизненный цикл подписки»), so for a caller that already saw the row
 * confirmed this is a race guard, not a reachable branch under normal
 * operation.
 */
export const mintUnsubscribeToken = async (
  db: Prisma.TransactionClient,
  where: { id: string } | { email: string },
): Promise<MintedUnsubscribeToken | null> => {
  const unsubscribe = generateVeilleToken();
  const veille = await nullIfRecordNotFound(() =>
    db.veille.update({
      where: { ...where, confirmedAt: { not: null } },
      data: { unsubscribeTokens: { create: { tokenHash: unsubscribe.hash } } },
      select: { email: true },
    }),
  );
  return veille && { email: veille.email, unsubscribeToken: unsubscribe.token };
};
