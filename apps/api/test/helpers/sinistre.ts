import type { PrismaClient } from 'src/generated/prisma/client';
import { commune } from 'test/helpers/commune';
import { userData } from 'test/helpers/user-data';

/**
 * The one `Sinistre` row shape schema-level specs need (raw `PrismaClient`, no
 * NestJS bootstrap): a dossier opened before any arrêté. App-level specs create
 * one through `POST /sinistres` instead.
 */
export const sinistreData = (overrides: {
  userId: string;
  codeInsee: string;
  arreteEntryId?: string | null;
}) => ({
  userId: overrides.userId,
  codeInsee: overrides.codeInsee,
  risque: 'INONDATION' as const,
  eventDate: new Date('2026-06-15'),
  arreteEntryId: overrides.arreteEntryId ?? null,
  declarationDate: null,
  status: 'AVANT_ARRETE' as const,
});

/** The `User` → `Commune` → `Sinistre` chain every dossier needs before the row
 * under test: specs that assert on the chain itself pass their own commune code. */
export const createSinistre = async (
  prisma: PrismaClient,
  codeInsee = '30189',
) => {
  const user = await prisma.user.create({ data: userData() });
  await prisma.commune.create({
    data: commune(codeInsee, 'Nîmes', '30', 'Gard'),
  });
  const sinistre = await prisma.sinistre.create({
    data: sinistreData({ userId: user.id, codeInsee }),
  });
  return { user, sinistre };
};
