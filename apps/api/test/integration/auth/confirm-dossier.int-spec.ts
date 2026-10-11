import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  RisqueCatnat,
  toIsoDate,
  type AccountConfirmationResponse,
  type SinistreDetail,
} from '@mon-sinistre/contracts';
import {
  hashSecureToken,
  SECURE_TOKEN_LENGTH,
} from 'src/common/security/secure-token';
import { DAY_MS, HOUR_MS } from 'src/common/time/time';
import { seedDeadlineRules } from 'src/deadline-rules/deadline-rule.seed';
import { resolveDeadline } from 'src/deadline-rules/resolve-deadline';
import { PrismaService } from 'src/prisma/prisma.service';
import { seedStepTemplates } from 'src/step-templates/step-template.seed';
import { createIntTestApp } from 'test/helpers/app';
import { arreteData, arreteEntryData } from 'test/helpers/arrete';
import { commune } from 'test/helpers/commune';
import { createUser, headersForEmail } from 'test/helpers/session';

const CODE_INSEE = '30189';
const EVENT_DATE = toIsoDate('2026-06-10');
const PUBLISHED_AT = toIsoDate('2026-06-15');
const TOKEN = 'a'.repeat(SECURE_TOKEN_LENGTH);

// Подтверждение адреса превращает досье, принесённое регистрацией, в синистр:
// docs/plan/dossier-preliminaire.md, Фаза 4 (issue #259);
// docs/research/dossier-preliminaire.md, «Три параметра до подтверждения».
describe('POST /auth/confirmation draining a pending dossier (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const confirm = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/confirmation',
      payload: { token },
    });

  beforeAll(async () => {
    app = await createIntTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune", "DeadlineRule", "StepTemplate", "Arrete" CASCADE`;
    await prisma.commune.create({
      data: commune(CODE_INSEE, 'Nîmes', '30', 'Gard'),
    });
    await seedDeadlineRules(prisma);
    await seedStepTemplates(prisma);
  });

  /** An unconfirmed account holding its confirmation token, with the dossier
   * its registration carried unless `dossier: false`. */
  const createPendingAccount = async (
    overrides: { confirmExpiresAt?: Date; dossier?: boolean } = {},
  ): Promise<{ email: string; userId: string }> => {
    const email = await createUser(prisma, {
      confirmTokenHash: hashSecureToken(TOKEN),
      confirmExpiresAt: overrides.confirmExpiresAt,
      confirmedAt: null,
    });
    const { id } = await prisma.user.findUniqueOrThrow({ where: { email } });
    if (overrides.dossier !== false) {
      await prisma.dossierEnAttente.create({
        data: {
          userId: id,
          codeInsee: CODE_INSEE,
          risque: RisqueCatnat.INONDATION,
          eventDate: new Date(EVENT_DATE),
        },
      });
    }
    return { email, userId: id };
  };

  /** A `RECONNU` annex line already ingested for the commune and the event. */
  const createReconnuEntry = async () => {
    const arrete = await prisma.arrete.create({
      data: {
        ...arreteData(),
        publishedAt: new Date(PUBLISHED_AT),
        entries: { create: [arreteEntryData(CODE_INSEE)] },
      },
      include: { entries: true },
    });
    return arrete.entries[0]!;
  };

  it('creates the sinistre the dossier names, answers its id and clears the row', async () => {
    const { email } = await createPendingAccount();
    const entry = await createReconnuEntry();
    const rule = await prisma.deadlineRule.findFirstOrThrow({
      where: { code: 'DECLARATION_ASSUREUR' },
    });

    const res = await confirm(TOKEN);

    expect(res.statusCode).toBe(200);
    const { status, sinistreId } = JSON.parse(
      res.payload,
    ) as AccountConfirmationResponse;
    expect(status).toBe('confirmed');
    expect(await prisma.dossierEnAttente.count()).toBe(0);

    // The dossier as its owner's own session sees it — the three parameters
    // reached the sinistre the response names.
    const read = await app.inject({
      method: 'GET',
      url: `/sinistres/${sinistreId}`,
      headers: await headersForEmail(app, prisma, email),
    });
    expect(read.statusCode).toBe(200);
    const sinistre = JSON.parse(read.payload) as SinistreDetail;
    expect(sinistre).toMatchObject({
      commune: { codeInsee: CODE_INSEE },
      risque: RisqueCatnat.INONDATION,
      eventDate: EVENT_DATE,
      status: 'ARRETE_PUBLIE',
      arreteEntryId: entry.id,
    });
    expect(sinistre.declarationDeadline?.date).toBe(
      resolveDeadline(PUBLISHED_AT, rule.duration, rule.unit),
    );
  });

  it('creates nothing a second time: the repeat confirmation answers without an id', async () => {
    await createPendingAccount();

    const first = await confirm(TOKEN);
    const second = await confirm(TOKEN);

    expect(
      (JSON.parse(first.payload) as AccountConfirmationResponse).sinistreId,
    ).toEqual(expect.any(String));
    expect(JSON.parse(second.payload)).toEqual({ status: 'confirmed' });
    expect(await prisma.sinistre.count()).toBe(1);
  });

  it('answers as it did before the dossier existed when none is stored', async () => {
    await createPendingAccount({ dossier: false });

    const res = await confirm(TOKEN);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'confirmed' });
    expect(await prisma.sinistre.count()).toBe(0);
  });

  it('creates the sinistre when a password reset is what confirms the account', async () => {
    const { userId } = await createPendingAccount();
    const token = 'b'.repeat(SECURE_TOKEN_LENGTH);
    await prisma.passwordReset.create({
      data: {
        userId,
        tokenHash: hashSecureToken(token),
        expiresAt: new Date(Date.now() + HOUR_MS),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token, password: 'NewPass12' },
    });

    expect(res.statusCode).toBe(200);
    const sinistre = await prisma.sinistre.findFirstOrThrow();
    expect(JSON.parse(res.payload)).toEqual({
      status: 'reset',
      sinistreId: sinistre.id,
    });
    expect(sinistre).toMatchObject({
      userId,
      codeInsee: CODE_INSEE,
      risque: RisqueCatnat.INONDATION,
      eventDate: new Date(EVENT_DATE),
    });
    expect(await prisma.dossierEnAttente.count()).toBe(0);
  });

  it('creates the sinistre on the successor when the stored commune has been merged since', async () => {
    const successor = '30999';
    await prisma.commune.create({
      data: commune(successor, 'Nîmes-Métropole', '30', 'Gard'),
    });
    await createPendingAccount();
    await prisma.commune.update({
      where: { codeInsee: CODE_INSEE },
      data: {
        effectiveTo: new Date('2026-07-01'),
        successorCodeInsee: successor,
      },
    });

    const res = await confirm(TOKEN);

    const { sinistreId } = JSON.parse(
      res.payload,
    ) as AccountConfirmationResponse;
    const sinistre = await prisma.sinistre.findUniqueOrThrow({
      where: { id: sinistreId },
    });
    expect(sinistre).toMatchObject({
      codeInsee: successor,
      risque: RisqueCatnat.INONDATION,
      eventDate: new Date(EVENT_DATE),
    });
    expect(await prisma.dossierEnAttente.count()).toBe(0);
  });

  it('confirms the account anyway when the stored commune has been closed with no successor', async () => {
    await createPendingAccount();
    await prisma.commune.update({
      where: { codeInsee: CODE_INSEE },
      data: { effectiveTo: new Date('2026-07-01') },
    });

    const res = await confirm(TOKEN);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'confirmed' });
    expect(await prisma.sinistre.count()).toBe(0);
    const user = await prisma.user.findFirstOrThrow();
    expect(user.confirmedAt).not.toBeNull();
    // Spent even unspendable: the cleanup never comes back for a confirmed
    // account's row.
    expect(await prisma.dossierEnAttente.count()).toBe(0);
  });

  it('leaves the dossier stored when the token has expired, for the cleanup to take', async () => {
    await createPendingAccount({
      confirmExpiresAt: new Date(Date.now() - DAY_MS),
    });

    const res = await confirm(TOKEN);

    expect(JSON.parse(res.payload)).toEqual({ status: 'invalid' });
    expect(await prisma.sinistre.count()).toBe(0);
    expect(await prisma.dossierEnAttente.count()).toBe(1);
  });
});
