import type { PrismaService } from 'src/prisma/prisma.service';
import { nextConfirmExpiresAt } from './veille.service';
import { generateVeilleToken } from './veille-token';

/** Minimal `Commune` row good enough for veille's FK on `VeilleCommune`. */
export const communeFixture = (codeInsee: string, name: string) => ({
  codeInsee,
  name,
  departementCode: codeInsee.slice(0, 2),
  departementName: 'Gard',
  sourceUrl: 'https://geo.api.gouv.fr/communes',
  sourceVerifiedAt: new Date('2026-08-16'),
});

/**
 * One subscription factory for every veille int-spec. Communes are opt-in and
 * their rows are the caller's business (`communeFixture` above): only the
 * cascade test needs them, and the FK insert is not free.
 */
export const createVeille = async (
  prisma: PrismaService,
  overrides: Partial<{
    confirmedAt: Date | null;
    confirmExpiresAt: Date;
    communeCodes: string[];
  }> = {},
): Promise<{ confirmToken: string; unsubscribeToken: string }> => {
  const confirm = generateVeilleToken();
  const unsubscribe = generateVeilleToken();
  await prisma.veille.create({
    data: {
      email: `riverain-${Math.random()}@example.fr`,
      confirmTokenHash: confirm.hash,
      unsubscribeTokenHash: unsubscribe.hash,
      confirmedAt: overrides.confirmedAt ?? null,
      confirmExpiresAt: overrides.confirmExpiresAt ?? nextConfirmExpiresAt(),
      ...(overrides.communeCodes && {
        communes: {
          create: overrides.communeCodes.map((codeInsee) => ({ codeInsee })),
        },
      }),
    },
  });
  return { confirmToken: confirm.token, unsubscribeToken: unsubscribe.token };
};
