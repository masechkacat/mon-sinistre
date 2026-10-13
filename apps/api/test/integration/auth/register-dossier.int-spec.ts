import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RisqueCatnat } from '@mon-sinistre/contracts';
import { createIntTestApp } from 'test/helpers/app.js';
import { commune } from 'test/helpers/commune.js';
import { createUser, PASSWORD } from 'test/helpers/session.js';
import { fr } from 'src/i18n/fr.js';
import { MAIL_TRANSPORT } from 'src/mail/mail-transport.js';
import { PrismaService } from 'src/prisma/prisma.service.js';
import { RecordingTransport } from 'test/helpers/mail-transport.js';
import { resetThrottler } from 'test/helpers/throttler.js';
import { tomorrowInParis } from 'test/helpers/dates.js';

const CODE_INSEE = '30189';
const EMAIL = 'victime@example.fr';
const DOSSIER = {
  codeInsee: CODE_INSEE,
  risque: RisqueCatnat.INONDATION,
  eventDate: '2026-10-05',
};

describe('POST /auth/register with a dossier (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let transport: RecordingTransport;

  const post = (body: object) =>
    app.inject({ method: 'POST', url: '/auth/register', payload: body });

  beforeAll(async () => {
    transport = new RecordingTransport();
    app = await createIntTestApp({
      customize: (builder) =>
        builder.overrideProvider(MAIL_TRANSPORT).useValue(transport),
    });

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    transport.sent.length = 0;
    // Same reason as `register.int-spec.ts`: these specs submit the form more
    // often than a person would, and the whole file shares one IP counter.
    resetThrottler(app);
    await prisma.$executeRaw`TRUNCATE TABLE "User", "AccountFormEmail", "Commune" CASCADE`;
    await prisma.commune.create({
      data: commune(CODE_INSEE, 'Nîmes', '30', 'Gard'),
    });
  });

  it('stores the three parameters against the brand-new account', async () => {
    const res = await post({
      email: EMAIL,
      password: PASSWORD,
      dossier: DOSSIER,
    });

    expect(res.statusCode).toBe(204);
    const user = await prisma.user.findFirstOrThrow();
    const row = await prisma.dossierEnAttente.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(row).toMatchObject({
      codeInsee: CODE_INSEE,
      risque: RisqueCatnat.INONDATION,
      eventDate: new Date('2026-10-05'),
    });
  });

  it('rewrites the stored dossier when the unconfirmed address registers again with another date', async () => {
    await post({ email: EMAIL, password: PASSWORD, dossier: DOSSIER });

    const again = await post({
      email: EMAIL,
      password: PASSWORD,
      dossier: { ...DOSSIER, eventDate: '2026-09-01' },
    });

    expect(again.statusCode).toBe(204);
    const rows = await prisma.dossierEnAttente.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventDate).toEqual(new Date('2026-09-01'));
  });

  it('keeps the stored dossier when the unconfirmed address registers again without one', async () => {
    await post({ email: EMAIL, password: PASSWORD, dossier: DOSSIER });

    // Unlike the password, an absent dossier is not the last form's answer to
    // the question: the plain registration form never asked it.
    const again = await post({ email: EMAIL, password: PASSWORD });

    expect(again.statusCode).toBe(204);
    const rows = await prisma.dossierEnAttente.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventDate).toEqual(new Date('2026-10-05'));
  });

  it('writes nothing for a confirmed address, and answers as it would without a dossier', async () => {
    const email = await createUser(prisma, { email: EMAIL });

    const withDossier = await post({
      email,
      password: 'Def!67890',
      dossier: DOSSIER,
    });
    const without = await post({ email, password: 'Def!67890' });

    expect(withDossier.statusCode).toBe(204);
    expect(withDossier.statusCode).toBe(without.statusCode);
    expect(withDossier.payload).toBe(without.payload);
    expect(await prisma.dossierEnAttente.findMany()).toEqual([]);
  });

  it('rejects a dossier whose eventDate is in the future, creating no account', async () => {
    const res = await post({
      email: EMAIL,
      password: PASSWORD,
      dossier: { ...DOSSIER, eventDate: tomorrowInParis() },
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain(fr.sinistres.eventDateInFuture);
    expect(await prisma.user.findMany()).toEqual([]);
  });

  it.each([
    [
      'carrying a field the contract does not have',
      { ...DOSSIER, surname: 'X' },
    ],
    ['carrying confirmNew', { ...DOSSIER, confirmNew: true }],
    ['sent as an array', [DOSSIER]],
    ['sent as an empty array', []],
  ])('rejects a dossier %s, creating no account', async (_, dossier) => {
    const res = await post({ email: EMAIL, password: PASSWORD, dossier });

    expect(res.statusCode).toBe(400);
    expect(await prisma.user.findMany()).toEqual([]);
  });

  it('rejects a dossier naming a commune the referential does not know, creating no account', async () => {
    const res = await post({
      email: EMAIL,
      password: PASSWORD,
      dossier: { ...DOSSIER, codeInsee: '99999' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain(fr.sinistres.unknownCommune);
    expect(await prisma.user.findMany()).toEqual([]);
    expect(transport.sent).toEqual([]);
  });
});
