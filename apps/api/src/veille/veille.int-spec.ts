import { createHash } from 'node:crypto';

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import {
  VEILLE_CONFIRM_PATH,
  VEILLE_MAX_COMMUNES,
  VEILLE_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { createIntTestApp } from 'src/app.int-helper';
import { fr } from 'src/i18n/fr';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { mailLinksOf } from 'src/mail/mail-links.test-helper';
import type { MailMessage } from 'src/mail/mail-message';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';
import { PrismaService } from 'src/prisma/prisma.service';
import { VEILLE_FORM_RATE_LIMIT } from './veille.controller';
import { communeFixture } from './veille.test-helper';

class RecordingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

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
  let throttler: ThrottlerStorageService;
  const logs = captureLogs();

  const post = (body: object) =>
    app.inject({ method: 'POST', url: '/veille', payload: body });

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
    // Every test shares one client address, so without this the rate limit of
    // the route would count the whole file as a single caller.
    throttler.storage.clear();
    await prisma.$executeRaw`TRUNCATE TABLE "Veille", "Commune" CASCADE`;
  });

  it('creates a subscription with hashed tokens and sends the confirmation mail', async () => {
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });

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

    const confirmToken = tokenFrom(message, VEILLE_CONFIRM_PATH);
    expect(veille.confirmTokenHash).toBe(
      createHash('sha256').update(confirmToken).digest('hex'),
    );
    // The database holds the hash, never the token that went out in the link.
    expect(veille.confirmTokenHash).not.toBe(confirmToken);

    const unsubscribeToken = tokenFrom(message, VEILLE_UNSUBSCRIBE_PATH);
    expect(veille.unsubscribeTokenHash).toBe(
      createHash('sha256').update(unsubscribeToken).digest('hex'),
    );
    expect(veille.unsubscribeTokenHash).not.toBe(unsubscribeToken);
  });

  it('creates exactly one subscription for two spellings of the same address', async () => {
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });

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
    // The second spelling normalizes to the same, still-unconfirmed address —
    // it resends the confirmation mail rather than creating a second row.
    expect(transport.sent).toHaveLength(2);
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
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });

    const res = await post({
      email: 'riverain@example.fr',
      communeCodes: ['30189', '30189'],
    });

    expect(res.statusCode).toBe(204);
    const rows = await prisma.veilleCommune.findMany();
    expect(rows).toHaveLength(1);
  });

  it('stops mailing further addresses once one caller passes the rate limit', async () => {
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
    const submit = (n: number) =>
      post({ email: `riverain${n}@example.fr`, communeCodes: ['30189'] });

    for (let i = 0; i < VEILLE_FORM_RATE_LIMIT.limit; i++) {
      expect((await submit(i)).statusCode).toBe(204);
    }
    const refused = await submit(VEILLE_FORM_RATE_LIMIT.limit);

    expect(refused.statusCode).toBe(429);
    expect(transport.sent).toHaveLength(VEILLE_FORM_RATE_LIMIT.limit);
  });

  it('never logs the email address, on success or on a rejected commune code', async () => {
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
    const email = 'riverain@example.fr';

    await post({ email, communeCodes: ['30189'] });
    await post({ email, communeCodes: ['99999'] });

    logs.expectNoTraceOf(email);
  });

  describe('resubmission of an unconfirmed address', () => {
    it('rewrites the commune composition from the latest form and extends the deadline, without creating a second subscription', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      await prisma.commune.create({
        data: communeFixture('34172', 'Montpellier'),
      });
      const email = 'riverain@example.fr';

      const first = await post({ email, communeCodes: ['30189'] });
      expect(first.statusCode).toBe(204);
      const firstVeille = await prisma.veille.findFirstOrThrow();

      const second = await post({ email, communeCodes: ['34172'] });
      expect(second.statusCode).toBe(204);

      const rows = await prisma.veille.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(firstVeille.id);
      expect(rows[0]?.confirmExpiresAt.getTime()).toBeGreaterThan(
        firstVeille.confirmExpiresAt.getTime(),
      );

      const communes = await prisma.veilleCommune.findMany({
        where: { veilleId: firstVeille.id },
      });
      expect(communes.map((c) => c.codeInsee)).toEqual(['34172']);

      // "уходит новое письмо подтверждения" — docs/plan, phase 3.
      expect(transport.sent).toHaveLength(2);
    });

    it('keeps the confirmation link from the first mail working', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      await prisma.commune.create({
        data: communeFixture('34172', 'Montpellier'),
      });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const [firstMail] = transport.sent;
      if (!firstMail) throw new Error('expected a first mail to be sent');
      const firstConfirmToken = tokenFrom(firstMail, VEILLE_CONFIRM_PATH);

      await post({ email, communeCodes: ['34172'] });

      const res = await app.inject({
        method: 'GET',
        url: `/veille/confirmation?token=${firstConfirmToken}`,
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'pending' });
    });

    it('does not let a race between two submissions of the same new address surface as 500 or 409', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const email = 'riverain-race@example.fr';

      const [first, second] = await Promise.all([
        post({ email, communeCodes: ['30189'] }),
        post({ email, communeCodes: ['30189'] }),
      ]);

      expect(first.statusCode).toBe(204);
      expect(second.statusCode).toBe(204);
      expect(await prisma.veille.findMany({ where: { email } })).toHaveLength(
        1,
      );
    });

    it('does not 500 when a concurrent desinscription deletes the row while the resubmission is rewriting it', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const veille = await prisma.veille.findFirstOrThrow();

      // Between `upsertSubscription`'s lookup and the interactive transaction
      // of `resubscribeUnconfirmed`, a desinscription for this same row
      // lands and deletes it — intercepted on `$transaction` itself, since
      // its callback runs against a separate, transaction-scoped client that
      // a spy on `prisma.veille.updateMany` would never see.
      const originalTransaction = prisma.$transaction.bind(prisma);
      (
        jest.spyOn(prisma, '$transaction') as jest.SpyInstance
      ).mockImplementationOnce(async (...args: unknown[]) => {
        await prisma.veille.deleteMany({ where: { id: veille.id } });
        return originalTransaction(
          ...(args as Parameters<typeof originalTransaction>),
        );
      });

      const res = await post({ email, communeCodes: ['30189'] });

      expect(res.statusCode).toBe(204);
      expect(await prisma.veille.findMany({ where: { email } })).toEqual([]);
      // The row is gone — no resend mail on top of the first one.
      expect(transport.sent).toHaveLength(1);
    });
  });

  describe('resubmission of a confirmed address', () => {
    const confirm = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/veille/confirmation',
        payload: { token },
      });

    it('does not create a second subscription and leaves the commune composition untouched, even with a different list in the new form', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      await prisma.commune.create({
        data: communeFixture('34172', 'Montpellier'),
      });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const [firstMail] = transport.sent;
      if (!firstMail) throw new Error('expected a first mail to be sent');
      const confirmToken = tokenFrom(firstMail, VEILLE_CONFIRM_PATH);
      expect((await confirm(confirmToken)).statusCode).toBe(200);

      const second = await post({ email, communeCodes: ['34172'] });

      expect(second.statusCode).toBe(204);
      expect(second.payload).toBe('');

      const rows = await prisma.veille.findMany({ where: { email } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.confirmedAt).not.toBeNull();

      const communes = await prisma.veilleCommune.findMany({
        where: { veilleId: rows[0]?.id },
      });
      expect(communes.map((c) => c.codeInsee)).toEqual(['30189']);
    });

    it('sends a "déjà inscrit·e" mail listing the communes of the active subscription, with a working unsubscribe link', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      await prisma.commune.create({
        data: communeFixture('34172', 'Montpellier'),
      });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const [firstMail] = transport.sent;
      if (!firstMail) throw new Error('expected a first mail to be sent');
      const confirmToken = tokenFrom(firstMail, VEILLE_CONFIRM_PATH);
      await confirm(confirmToken);
      transport.sent.length = 0;

      const res = await post({ email, communeCodes: ['34172'] });

      expect(res.statusCode).toBe(204);
      expect(transport.sent).toHaveLength(1);
      const [reminder] = transport.sent;
      if (!reminder) throw new Error('expected a reminder mail to be sent');

      expect(reminder.subject).toBe(fr.mail.veille.alreadySubscribed.subject);
      // The submitted list (34172) is discarded — the mail names the
      // subscription's actual, unchanged composition (30189).
      expect(reminder.text).toContain('Nîmes (Gard)');
      expect(reminder.text).not.toContain('Montpellier (Gard)');

      // Reminder mails exist to reach someone who may have lost the mail
      // sent at creation time, so this link has to actually unsubscribe —
      // not just look like it does.
      const reminderUnsubscribeToken = tokenFrom(
        reminder,
        VEILLE_UNSUBSCRIBE_PATH,
      );
      const unsubscribeRes = await app.inject({
        method: 'POST',
        url: '/veille/desinscription',
        payload: { token: reminderUnsubscribeToken },
      });
      expect(unsubscribeRes.statusCode).toBe(204);
      expect(await prisma.veille.findMany({ where: { email } })).toEqual([]);
    });

    it('rotates the unsubscribe token, so the mail sent at creation time no longer unsubscribes on its own', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const [firstMail] = transport.sent;
      if (!firstMail) throw new Error('expected a first mail to be sent');
      const confirmToken = tokenFrom(firstMail, VEILLE_CONFIRM_PATH);
      const firstUnsubscribeToken = tokenFrom(
        firstMail,
        VEILLE_UNSUBSCRIBE_PATH,
      );
      await confirm(confirmToken);

      await post({ email, communeCodes: ['30189'] });

      const staleUnsubscribeRes = await app.inject({
        method: 'POST',
        url: '/veille/desinscription',
        payload: { token: firstUnsubscribeToken },
      });
      // Idempotent-looking 204 (anti-enumeration), but the row survives —
      // the reminder mail's freshly rotated link is the one that works now.
      expect(staleUnsubscribeRes.statusCode).toBe(204);
      expect(await prisma.veille.findMany({ where: { email } })).toHaveLength(
        1,
      );
    });
  });
});
