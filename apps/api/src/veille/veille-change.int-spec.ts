import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import {
  VEILLE_CHANGE_PATH,
  VEILLE_CONFIRM_PATH,
} from '@mon-sinistre/contracts';
import { createIntTestApp } from 'src/app.int-helper';
import { tokenFrom } from 'src/mail/mail-links.test-helper';
import { MAIL_TRANSPORT } from 'src/mail/mail-transport';
import { RecordingTransport } from 'src/mail/mail-transport.test-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { DAY_MS } from './veille.service';
import { communeFixture, createChangeRequest } from './veille.test-helper';

describe('GET /veille/changement (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let transport: RecordingTransport;
  let throttler: ThrottlerStorageService;

  const get = (token: string) =>
    app.inject({
      method: 'GET',
      url: `/veille/changement?token=${encodeURIComponent(token)}`,
    });

  const post = (body: object) =>
    app.inject({ method: 'POST', url: '/veille', payload: body });

  const confirm = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/veille/confirmation',
      payload: { token },
    });

  beforeAll(async () => {
    transport = new RecordingTransport();
    app = await createIntTestApp({
      customize: (builder) =>
        builder.overrideProvider(MAIL_TRANSPORT).useValue(transport),
    });
    prisma = app.get(PrismaService);
    throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    transport.sent.length = 0;
    throttler.storage.clear();
    await prisma.$executeRaw`TRUNCATE TABLE "Veille", "Commune", "VeilleFormEmail" CASCADE`;
  });

  it("does not change the active composition and returns the pending request's communes", async () => {
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
    await prisma.commune.create({
      data: communeFixture('34172', 'Montpellier'),
    });
    const { changeToken, veilleId } = await createChangeRequest(prisma, {
      communeCodes: ['34172'],
    });
    await prisma.veilleCommune.create({
      data: { veilleId, codeInsee: '30189' },
    });

    const res = await get(changeToken);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      status: 'pending',
      communes: [{ name: 'Montpellier', departementName: 'Gard' }],
    });
    const active = await prisma.veilleCommune.findMany({
      where: { veilleId },
    });
    expect(active.map((c) => c.codeInsee)).toEqual(['30189']);
  });

  it('reports "invalid" for an unknown token and for an expired request — indistinguishably', async () => {
    const { changeToken: expiredToken } = await createChangeRequest(prisma, {
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const unknown = await get('unknown-token');
    const expired = await get(expiredToken);

    expect(unknown.statusCode).toBe(200);
    expect(expired.statusCode).toBe(200);
    expect(JSON.parse(unknown.payload)).toEqual({ status: 'invalid' });
    expect(JSON.parse(expired.payload)).toEqual({ status: 'invalid' });
  });

  it('answers "invalid" for the previous link once a resubmission rotates the token, "pending" for the latest', async () => {
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
    await prisma.commune.create({
      data: communeFixture('34172', 'Montpellier'),
    });
    const email = 'riverain@example.fr';

    await post({ email, communeCodes: ['30189'] });
    const [creationMail] = transport.sent;
    if (!creationMail) throw new Error('expected a creation mail');
    expect(
      (await confirm(tokenFrom(creationMail, VEILLE_CONFIRM_PATH))).statusCode,
    ).toBe(200);

    await post({ email, communeCodes: ['34172'] });
    const firstChangeMail = transport.sent[1];
    if (!firstChangeMail) throw new Error('expected a first change mail');
    const staleToken = tokenFrom(firstChangeMail, VEILLE_CHANGE_PATH);

    await post({ email, communeCodes: ['30189'] });
    const latestChangeMail = transport.sent[transport.sent.length - 1];
    if (!latestChangeMail) throw new Error('expected a second change mail');
    const latestToken = tokenFrom(latestChangeMail, VEILLE_CHANGE_PATH);

    const staleRes = await get(staleToken);
    const latestRes = await get(latestToken);

    expect(JSON.parse(staleRes.payload)).toEqual({ status: 'invalid' });
    expect(JSON.parse(latestRes.payload)).toEqual({
      status: 'pending',
      communes: [{ name: 'Nîmes', departementName: 'Gard' }],
    });
  });
});
