import type { PrismaService } from 'src/prisma/prisma.service';
import { nextChangeExpiresAt, nextConfirmExpiresAt } from 'src/veille/veille.service';
import { commune } from 'test/helpers/commune';
import { generateVeilleToken } from 'src/veille/veille-token';

/**
 * A `Commune` row for veille's FK on `VeilleCommune`, where only the code has
 * to be right — the department is filler. The row itself comes from the
 * referential's own fixture, so the search key is derived exactly as the
 * import derives it and cannot drift from it here.
 */
export const communeFixture = (codeInsee: string, name: string) =>
  commune(codeInsee, name, codeInsee.slice(0, 2), 'Gard');

/**
 * One counter row of the daily mail limit, as `sendFormMail` writes it.
 * `sentAgoMs` places it inside or outside the 24-hour window the hourly
 * cleanup ages these rows out by; the hash stands for an address nobody here
 * needs to name.
 */
export const createFormEmail = async (
  prisma: PrismaService,
  sentAgoMs = 0,
): Promise<void> => {
  await prisma.veilleFormEmail.create({
    data: {
      emailHash: `hash-${sentAgoMs}`,
      sentAt: new Date(Date.now() - sentAgoMs),
    },
  });
};

/**
 * Minimal `Veille` row for schema-level int-specs — no token generation, no
 * service dependency. `createVeille` below is for specs that exercise the
 * service's own confirm/change flow.
 */
export function veilleData(overrides: Partial<{ email: string }> = {}) {
  return {
    email: overrides.email ?? `riverain-${Math.random()}@example.fr`,
    confirmTokenHash: `confirm-${Math.random()}`,
    unsubscribeTokenHash: `unsubscribe-${Math.random()}`,
    confirmExpiresAt: new Date('2026-08-22'),
  };
}

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
): Promise<{
  veilleId: string;
  confirmToken: string;
  unsubscribeToken: string;
}> => {
  const confirm = generateVeilleToken();
  const unsubscribe = generateVeilleToken();
  const veille = await prisma.veille.create({
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
  return {
    veilleId: veille.id,
    confirmToken: confirm.token,
    unsubscribeToken: unsubscribe.token,
  };
};

/**
 * A confirmed subscription plus its pending `VeilleChange` request — the
 * fixture every `/veille/changement` spec needs, without going through the
 * form/mail round trip that produces one in production. Built on
 * `createVeille` rather than writing its own `Veille` row.
 */
export const createChangeRequest = async (
  prisma: PrismaService,
  overrides: Partial<{
    expiresAt: Date;
    communeCodes: string[];
  }> = {},
): Promise<{
  changeToken: string;
  unsubscribeToken: string;
  veilleId: string;
}> => {
  const { veilleId, unsubscribeToken } = await createVeille(prisma, {
    confirmedAt: new Date(),
  });
  const change = generateVeilleToken();
  await prisma.veilleChange.create({
    data: {
      veilleId,
      changeTokenHash: change.hash,
      communeCodes: overrides.communeCodes ?? [],
      expiresAt: overrides.expiresAt ?? nextChangeExpiresAt(),
    },
  });
  return { changeToken: change.token, unsubscribeToken, veilleId };
};
