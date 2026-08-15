import { createHash } from 'node:crypto';

import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { VEILLE_MAX_COMMUNES } from '@mon-sinistre/contracts';
import { AppModule } from 'src/app.module';
import { createGlobalValidationPipe } from 'src/config/validation-pipe';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { mailLinksOf } from 'src/mail/mail-links.test-helper';
import type { MailMessage } from 'src/mail/mail-message';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';
import { PrismaService } from 'src/prisma/prisma.service';

class RecordingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

const SOURCE = {
  sourceUrl: 'https://geo.api.gouv.fr/communes',
  sourceVerifiedAt: new Date('2026-08-16'),
};

const commune = (codeInsee: string, name: string) => ({
  codeInsee,
  name,
  departementCode: codeInsee.slice(0, 2),
  departementName: 'Gard',
  ...SOURCE,
});

const tokenFrom = (message: MailMessage, path: string): string => {
  const url = [...mailLinksOf(message.text)].find((link) =>
    link.includes(path),
  );
  if (!url) throw new Error(`no link containing "${path}" in the mail`);
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error(`link "${url}" carries no token`);
  return token;
};

describe('POST /veille (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let transport: RecordingTransport;
  const logs = captureLogs();

  const post = (body: unknown) =>
    app.inject({ method: 'POST', url: '/veille', payload: body });

  beforeAll(async () => {
    transport = new RecordingTransport();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(transport)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // The exact pipe main.ts installs — the validation behaviour under test.
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    transport.sent.length = 0;
    await prisma.$executeRaw`TRUNCATE TABLE "Veille", "Commune" CASCADE`;
  });

  it('creates a subscription with hashed tokens and sends the confirmation mail', async () => {
    await prisma.commune.create({ data: commune('30189', 'Nîmes') });

    const res = await post({
      email: 'riverain@example.fr',
      communeCodes: ['30189'],
    });

    expect(res.statusCode).toBe(204);
    expect(res.payload).toBe('');

    const veille = await prisma.veille.findFirstOrThrow();
    expect(veille.confirmedAt).toBeNull();

    expect(transport.sent).toHaveLength(1);
    const [message] = transport.sent;
    if (!message) throw new Error('expected a message to have been sent');

    const confirmToken = tokenFrom(message, '/veille/confirmation');
    expect(veille.confirmTokenHash).toBe(
      createHash('sha256').update(confirmToken).digest('hex'),
    );
    // The database holds the hash, never the token that went out in the link.
    expect(veille.confirmTokenHash).not.toBe(confirmToken);

    const unsubscribeToken = tokenFrom(message, '/veille/desinscription');
    expect(veille.unsubscribeTokenHash).toBe(
      createHash('sha256').update(unsubscribeToken).digest('hex'),
    );
    expect(veille.unsubscribeTokenHash).not.toBe(unsubscribeToken);
  });

  it('creates exactly one subscription for two spellings of the same address', async () => {
    await prisma.commune.create({ data: commune('30189', 'Nîmes') });

    const first = await post({
      email: ' User@Example.fr ',
      communeCodes: ['30189'],
    });
    const second = await post({
      email: 'user@example.fr',
      communeCodes: ['30189'],
    });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);

    const rows = await prisma.veille.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('user@example.fr');
    // Only the first submission is a new address — the mail sent for a
    // resubmission of an existing one arrives in a later phase.
    expect(transport.sent).toHaveLength(1);
  });

  it.each([
    ['zero communes', []],
    [
      `${VEILLE_MAX_COMMUNES + 1} communes`,
      Array.from({ length: VEILLE_MAX_COMMUNES + 1 }, (_, i) =>
        String(i).padStart(5, '0'),
      ),
    ],
  ])('rejects %s with 400', async (_label, communeCodes) => {
    const res = await post({
      email: 'riverain@example.fr',
      communeCodes,
    });

    expect(res.statusCode).toBe(400);
    expect(await prisma.veille.findMany()).toEqual([]);
  });

  it('rejects an unknown INSEE code with 400 and creates nothing', async () => {
    const res = await post({
      email: 'riverain@example.fr',
      communeCodes: ['99999'],
    });

    expect(res.statusCode).toBe(400);
    expect(await prisma.veille.findMany()).toEqual([]);
    expect(transport.sent).toHaveLength(0);
  });

  it('treats a code repeated in the form as one commune, not a validation error', async () => {
    await prisma.commune.create({ data: commune('30189', 'Nîmes') });

    const res = await post({
      email: 'riverain@example.fr',
      communeCodes: ['30189', '30189'],
    });

    expect(res.statusCode).toBe(204);
    const rows = await prisma.veilleCommune.findMany();
    expect(rows).toHaveLength(1);
  });

  it('never logs the email address, on success or on a rejected commune code', async () => {
    await prisma.commune.create({ data: commune('30189', 'Nîmes') });
    const email = 'riverain@example.fr';

    await post({ email, communeCodes: ['30189'] });
    await post({ email, communeCodes: ['99999'] });

    logs.expectNoTraceOf(email);
  });
});
