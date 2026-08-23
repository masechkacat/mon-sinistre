import { createHash } from 'node:crypto';

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import {
  VEILLE_CHANGE_PATH,
  VEILLE_CONFIRM_PATH,
  VEILLE_FORM_EMAIL_DAILY_LIMIT,
  VEILLE_MAX_COMMUNES,
  VEILLE_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { createIntTestApp } from 'src/app.int-helper';
import { fr } from 'src/i18n/fr';
import { MailComposer } from 'src/mail/mail-composer';
import { MailCompositionError } from 'src/mail/mail-composition.error';
import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { tokenFrom } from 'src/mail/mail-links.test-helper';
import type { MailMessage } from 'src/mail/mail-message';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';
import { PrismaService } from 'src/prisma/prisma.service';
import { VEILLE_FORM_RATE_LIMIT } from 'src/veille/veille.controller';
import { DAY_MS, VeilleService } from 'src/veille/veille.service';
import { communeFixture } from 'src/veille/veille.test-helper';

class RecordingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  /** Consumed by the next `send()` only — a one-shot failure for a single test. */
  failNext = false;

  send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new MailDeliveryError('boom'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

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
    transport.failNext = false;
    // Every test shares one client address, so without this the rate limit of
    // the route would count the whole file as a single caller.
    throttler.storage.clear();
    await prisma.$executeRaw`TRUNCATE TABLE "Veille", "Commune", "VeilleFormEmail" CASCADE`;
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

    it('rotates both tokens: the resent mail confirms and unsubscribes, superseding the first mail', async () => {
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
      const resentMail = transport.sent[1];
      if (!resentMail) throw new Error('expected a resent mail');

      // The resent mail exists for an address that lost the first one, so
      // its own links must actually work — the first mail's stop matching.
      const staleRes = await app.inject({
        method: 'GET',
        url: `/veille/confirmation?token=${firstConfirmToken}`,
      });
      expect(JSON.parse(staleRes.payload)).toEqual({ status: 'invalid' });

      const confirmRes = await app.inject({
        method: 'POST',
        url: '/veille/confirmation',
        payload: { token: tokenFrom(resentMail, VEILLE_CONFIRM_PATH) },
      });
      expect(confirmRes.statusCode).toBe(200);
      expect(JSON.parse(confirmRes.payload)).toEqual({ status: 'active' });

      const unsubscribeRes = await app.inject({
        method: 'POST',
        url: '/veille/desinscription',
        payload: { token: tokenFrom(resentMail, VEILLE_UNSUBSCRIBE_PATH) },
      });
      expect(unsubscribeRes.statusCode).toBe(204);
      expect(await prisma.veille.findMany({ where: { email } })).toEqual([]);
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

    /**
     * Stages an interleaving around the interactive transaction
     * `claimUnconfirmed` opens: `before` lands as it is about to start, `after`
     * once it has committed. Its callback runs against a transaction-scoped
     * client that a spy on `prisma.veille` would never see, so `$transaction`
     * itself is the only place to stand.
     */
    const raceTransaction = (races: {
      before?: () => Promise<unknown>;
      after?: () => Promise<unknown>;
    }): void => {
      const original = prisma.$transaction.bind(prisma);
      (
        jest.spyOn(prisma, '$transaction') as jest.SpyInstance
      ).mockImplementation(async (...args: unknown[]) => {
        await races.before?.();
        const result: unknown = await original(
          ...(args as Parameters<typeof original>),
        );
        await races.after?.();
        return result;
      });
    };

    it('answers 204 and says so in the log when the unique-index race is lost twice', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const email = 'riverain@example.fr';
      await post({ email, communeCodes: ['30189'] });
      transport.sent.length = 0;

      // The row is gone just before each claim and back before the create that
      // follows it — a desinscription and a resubmission of the same address
      // landing around this one, twice over, so that both creates meet the
      // real unique index.
      let reborn = 0;
      raceTransaction({
        before: () => prisma.veille.deleteMany({ where: { email } }),
        after: () => {
          reborn += 1;
          return prisma.veille.create({
            data: {
              email,
              confirmTokenHash: `confirm-${reborn}`,
              unsubscribeTokenHash: `unsubscribe-${reborn}`,
              confirmExpiresAt: new Date(Date.now() + DAY_MS),
            },
          });
        },
      });

      const res = await post({ email, communeCodes: ['30189'] });

      // The always-204 contract holds even here: a 500 would be a
      // timing-dependent signal that the address currently exists.
      expect(res.statusCode).toBe(204);
      expect(transport.sent).toHaveLength(0);
      expect(await prisma.veille.findMany({ where: { email } })).toHaveLength(
        1,
      );
      // The submission was dropped. Silence towards the caller is deliberate;
      // silence in the log too would make it indistinguishable from a mail
      // that simply never arrived.
      expect(logs.levels()).toContain('warn');
      logs.expectNoTraceOf(email);
    });

    it('creates the subscription anew when the hourly cleanup deletes the expired row just before the claim', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const expired = await prisma.veille.findFirstOrThrow();
      await prisma.veille.update({
        where: { id: expired.id },
        data: { confirmExpiresAt: new Date(Date.now() - 1000) },
      });
      transport.sent.length = 0;

      raceTransaction({
        before: () => app.get(VeilleService).deleteExpiredUnconfirmed(),
      });

      const res = await post({ email, communeCodes: ['30189'] });

      // Nothing to revive and nothing to answer for: the form creates the
      // subscription anew rather than dropping a submission for the second
      // the cleanup happens to run in.
      expect(res.statusCode).toBe(204);
      const rows = await prisma.veille.findMany({ where: { email } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).not.toBe(expired.id);
      expect(transport.sent).toHaveLength(1);
    });

    it('does not undo a desinscription that lands once the claim has committed', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const veille = await prisma.veille.findFirstOrThrow();

      // The one window a claim leaves: the row is rewritten, the desinscription
      // deletes it, and the resend finds nothing left to rotate tokens on.
      raceTransaction({
        after: () => prisma.veille.deleteMany({ where: { id: veille.id } }),
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

    it('leaves the active commune composition untouched and writes a single pending change request carrying the latest form’s composition', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      await prisma.commune.create({
        data: communeFixture('34172', 'Montpellier'),
      });
      await prisma.commune.create({ data: communeFixture('75056', 'Paris') });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const [firstMail] = transport.sent;
      if (!firstMail) throw new Error('expected a first mail to be sent');
      expect(
        (await confirm(tokenFrom(firstMail, VEILLE_CONFIRM_PATH))).statusCode,
      ).toBe(200);

      // Same 204/empty response as a new or unconfirmed address — the caller
      // cannot tell which branch it took.
      const second = await post({ email, communeCodes: ['34172'] });
      expect(second.statusCode).toBe(204);
      expect(second.payload).toBe('');

      const veille = await prisma.veille.findFirstOrThrow({
        where: { email },
      });
      const communes = await prisma.veilleCommune.findMany({
        where: { veilleId: veille.id },
      });
      expect(communes.map((c) => c.codeInsee)).toEqual(['30189']);

      // A further submission rewrites the same request rather than adding a
      // second one — `veilleId @unique` holds this at the schema level too.
      await post({ email, communeCodes: ['75056'] });
      const changes = await prisma.veilleChange.findMany({
        where: { veilleId: veille.id },
      });
      expect(changes).toHaveLength(1);
      expect(changes[0]?.communeCodes).toEqual(['75056']);
    });

    it('sends a change mail listing the new composition, with a working unsubscribe link', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      await prisma.commune.create({
        data: communeFixture('34172', 'Montpellier'),
      });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const [firstMail] = transport.sent;
      if (!firstMail) throw new Error('expected a first mail to be sent');
      await confirm(tokenFrom(firstMail, VEILLE_CONFIRM_PATH));
      transport.sent.length = 0;

      const res = await post({ email, communeCodes: ['34172'] });
      expect(res.statusCode).toBe(204);
      expect(transport.sent).toHaveLength(1);
      const [changeMail] = transport.sent;
      if (!changeMail) throw new Error('expected a change mail to be sent');

      expect(changeMail.subject).toBe(fr.mail.veille.change.subject);
      // The mail names the *new* composition (34172), not the still-active
      // one (30189) — the reader confirms what they are about to get.
      expect(changeMail.text).toContain('Montpellier (Gard)');
      expect(changeMail.text).not.toContain('Nîmes (Gard)');

      const unsubscribeRes = await app.inject({
        method: 'POST',
        url: '/veille/desinscription',
        payload: { token: tokenFrom(changeMail, VEILLE_UNSUBSCRIBE_PATH) },
      });
      expect(unsubscribeRes.statusCode).toBe(204);
      expect(await prisma.veille.findMany({ where: { email } })).toEqual([]);
    });

    it('rotates both the change and the unsubscribe token on every submission, so the previous mail’s links stop matching', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      await prisma.commune.create({
        data: communeFixture('34172', 'Montpellier'),
      });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const [firstMail] = transport.sent;
      if (!firstMail) throw new Error('expected a first mail to be sent');
      const firstUnsubscribeToken = tokenFrom(
        firstMail,
        VEILLE_UNSUBSCRIBE_PATH,
      );
      await confirm(tokenFrom(firstMail, VEILLE_CONFIRM_PATH));
      transport.sent.length = 0;

      await post({ email, communeCodes: ['34172'] });
      const [firstChangeMail] = transport.sent;
      if (!firstChangeMail) throw new Error('expected a first change mail');
      const staleChangeToken = tokenFrom(firstChangeMail, VEILLE_CHANGE_PATH);

      await post({ email, communeCodes: ['30189'] });

      const veille = await prisma.veille.findFirstOrThrow({
        where: { email },
      });
      const change = await prisma.veilleChange.findUniqueOrThrow({
        where: { veilleId: veille.id },
      });
      expect(change.changeTokenHash).not.toBe(
        createHash('sha256').update(staleChangeToken).digest('hex'),
      );

      // Idempotent-looking 204 (anti-enumeration), but the row survives —
      // the latest change mail's freshly rotated link is the one that works.
      const staleUnsubscribeRes = await app.inject({
        method: 'POST',
        url: '/veille/desinscription',
        payload: { token: firstUnsubscribeToken },
      });
      expect(staleUnsubscribeRes.statusCode).toBe(204);
      expect(await prisma.veille.findMany({ where: { email } })).toHaveLength(
        1,
      );
    });

    // The 400 itself (0 or > VEILLE_MAX_COMMUNES communes) is already proven
    // by the general validation tests above, for every address state — this
    // one case is only here to prove the additional invariant of this
    // branch: a rejected form must not touch VeilleChange either.
    it('rejects more than VEILLE_MAX_COMMUNES communes with 400, creating no change request and leaving the composition untouched', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const [firstMail] = transport.sent;
      if (!firstMail) throw new Error('expected a first mail to be sent');
      await confirm(tokenFrom(firstMail, VEILLE_CONFIRM_PATH));

      const res = await post({
        email,
        communeCodes: Array.from({ length: VEILLE_MAX_COMMUNES + 1 }, (_, i) =>
          String(i).padStart(5, '0'),
        ),
      });

      expect(res.statusCode).toBe(400);
      const veille = await prisma.veille.findFirstOrThrow({
        where: { email },
      });
      const communes = await prisma.veilleCommune.findMany({
        where: { veilleId: veille.id },
      });
      expect(communes.map((c) => c.codeInsee)).toEqual(['30189']);
      expect(
        await prisma.veilleChange.findMany({ where: { veilleId: veille.id } }),
      ).toEqual([]);
    });

    it('never logs the email address on a confirmed resubmission', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      await prisma.commune.create({
        data: communeFixture('34172', 'Montpellier'),
      });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const [firstMail] = transport.sent;
      if (!firstMail) throw new Error('expected a first mail to be sent');
      await confirm(tokenFrom(firstMail, VEILLE_CONFIRM_PATH));

      await post({ email, communeCodes: ['34172'] });

      logs.expectNoTraceOf(email);
    });
  });

  describe('daily email limit per address (VEILLE_FORM_EMAIL_DAILY_LIMIT)', () => {
    it('sends no mail for the sixth form within 24h, but still answers 204 and applies the subscription change', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      await prisma.commune.create({
        data: communeFixture('34172', 'Montpellier'),
      });
      const email = 'riverain@example.fr';
      const submit = (i: number) => {
        throttler.storage.clear();
        return post({
          email,
          communeCodes: [i % 2 === 0 ? '30189' : '34172'],
        });
      };

      for (let i = 0; i < VEILLE_FORM_EMAIL_DAILY_LIMIT; i++) {
        const res = await submit(i);
        expect(res.statusCode).toBe(204);
        expect(res.payload).toBe('');
      }
      expect(transport.sent).toHaveLength(VEILLE_FORM_EMAIL_DAILY_LIMIT);

      // Sixth form (index 5, odd) — same 204/empty response, no sixth mail.
      const sixth = await submit(VEILLE_FORM_EMAIL_DAILY_LIMIT);
      expect(sixth.statusCode).toBe(204);
      expect(sixth.payload).toBe('');
      expect(transport.sent).toHaveLength(VEILLE_FORM_EMAIL_DAILY_LIMIT);
      expect(await prisma.veilleFormEmail.count()).toBe(
        VEILLE_FORM_EMAIL_DAILY_LIMIT,
      );

      // Composition still rewritten from the sixth (blocked) form.
      const veille = await prisma.veille.findFirstOrThrow({
        where: { email },
      });
      const communes = await prisma.veilleCommune.findMany({
        where: { veilleId: veille.id },
      });
      expect(communes.map((c) => c.codeInsee)).toEqual(['34172']);
    });

    it('does not rotate the tokens when the limit suppresses the resend — the last delivered mail keeps confirming', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const email = 'riverain@example.fr';

      // One creation mail plus resends up to the limit, all delivered.
      for (let i = 0; i < VEILLE_FORM_EMAIL_DAILY_LIMIT; i++) {
        throttler.storage.clear();
        expect(
          (await post({ email, communeCodes: ['30189'] })).statusCode,
        ).toBe(204);
      }
      const lastDelivered = transport.sent[VEILLE_FORM_EMAIL_DAILY_LIMIT - 1];
      if (!lastDelivered) throw new Error('expected a delivered mail');

      // Sixth form: mail suppressed — a rotation here would strand the
      // address with no working link at all until the row expires.
      throttler.storage.clear();
      expect((await post({ email, communeCodes: ['30189'] })).statusCode).toBe(
        204,
      );
      expect(transport.sent).toHaveLength(VEILLE_FORM_EMAIL_DAILY_LIMIT);

      const confirmRes = await app.inject({
        method: 'POST',
        url: '/veille/confirmation',
        payload: { token: tokenFrom(lastDelivered, VEILLE_CONFIRM_PATH) },
      });
      expect(confirmRes.statusCode).toBe(200);
      expect(JSON.parse(confirmRes.payload)).toEqual({ status: 'active' });
    });

    it('does not rotate the change or unsubscribe tokens when the limit suppresses the change mail, but still rewrites the pending request', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      await prisma.commune.create({
        data: communeFixture('34172', 'Montpellier'),
      });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });
      const [creationMail] = transport.sent;
      if (!creationMail) throw new Error('expected a creation mail');
      throttler.storage.clear();
      await app.inject({
        method: 'POST',
        url: '/veille/confirmation',
        payload: { token: tokenFrom(creationMail, VEILLE_CONFIRM_PATH) },
      });

      // Change mails up to the limit; the last delivered one carries the
      // tokens whose hashes are stored.
      for (let i = 1; i < VEILLE_FORM_EMAIL_DAILY_LIMIT; i++) {
        throttler.storage.clear();
        await post({ email, communeCodes: ['34172'] });
      }
      expect(transport.sent).toHaveLength(VEILLE_FORM_EMAIL_DAILY_LIMIT);
      const lastChangeMail = transport.sent[VEILLE_FORM_EMAIL_DAILY_LIMIT - 1];
      if (!lastChangeMail) throw new Error('expected a change mail');

      // Sixth form: suppressed — anonymous form submissions must not be able
      // to invalidate every delivered unsubscribe or change link (ТЗ § 7,
      // one-click), yet the request itself still reflects the latest form.
      throttler.storage.clear();
      expect((await post({ email, communeCodes: ['30189'] })).statusCode).toBe(
        204,
      );
      expect(transport.sent).toHaveLength(VEILLE_FORM_EMAIL_DAILY_LIMIT);

      const veille = await prisma.veille.findFirstOrThrow({
        where: { email },
      });
      const change = await prisma.veilleChange.findUniqueOrThrow({
        where: { veilleId: veille.id },
      });
      expect(change.communeCodes).toEqual(['30189']);
      expect(change.changeTokenHash).toBe(
        createHash('sha256')
          .update(tokenFrom(lastChangeMail, VEILLE_CHANGE_PATH))
          .digest('hex'),
      );

      const unsubscribeRes = await app.inject({
        method: 'POST',
        url: '/veille/desinscription',
        payload: {
          token: tokenFrom(lastChangeMail, VEILLE_UNSUBSCRIBE_PATH),
        },
      });
      expect(unsubscribeRes.statusCode).toBe(204);
      expect(await prisma.veille.findMany({ where: { email } })).toEqual([]);
    });

    it('is not reset by an unsubscribe/resubscribe cycle for the same address', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const email = 'riverain@example.fr';

      const first = await post({ email, communeCodes: ['30189'] });
      expect(first.statusCode).toBe(204);
      const [creationMail] = transport.sent;
      if (!creationMail) throw new Error('expected a creation mail');
      const confirmToken = tokenFrom(creationMail, VEILLE_CONFIRM_PATH);
      throttler.storage.clear();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/veille/confirmation',
            payload: { token: confirmToken },
          })
        ).statusCode,
      ).toBe(200);

      // Four more change mails bring the count to the limit.
      for (let i = 1; i < VEILLE_FORM_EMAIL_DAILY_LIMIT; i++) {
        throttler.storage.clear();
        const res = await post({ email, communeCodes: ['30189'] });
        expect(res.statusCode).toBe(204);
      }
      expect(transport.sent).toHaveLength(VEILLE_FORM_EMAIL_DAILY_LIMIT);

      const lastReminder = transport.sent[transport.sent.length - 1];
      if (!lastReminder) throw new Error('expected a change mail');
      const unsubscribeToken = tokenFrom(lastReminder, VEILLE_UNSUBSCRIBE_PATH);
      throttler.storage.clear();
      const unsub = await app.inject({
        method: 'POST',
        url: '/veille/desinscription',
        payload: { token: unsubscribeToken },
      });
      expect(unsub.statusCode).toBe(204);
      expect(await prisma.veille.findMany({ where: { email } })).toEqual([]);

      // A brand new subscription for the same address is still the sixth
      // form mail of the window — blocked, though the row is created again.
      throttler.storage.clear();
      const sixth = await post({ email, communeCodes: ['30189'] });
      expect(sixth.statusCode).toBe(204);
      expect(await prisma.veille.findMany({ where: { email } })).toHaveLength(
        1,
      );
      expect(transport.sent).toHaveLength(VEILLE_FORM_EMAIL_DAILY_LIMIT);
      expect(await prisma.veilleFormEmail.count()).toBe(
        VEILLE_FORM_EMAIL_DAILY_LIMIT,
      );
    });

    it('stores no email in VeilleFormEmail, only a hash that a keyless SHA-256 of the address would not match', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const email = 'riverain@example.fr';

      await post({ email, communeCodes: ['30189'] });

      const rows = await prisma.veilleFormEmail.findMany();
      expect(rows).toHaveLength(1);
      const [row] = rows;
      if (!row) throw new Error('expected a counter row');
      expect(row.emailHash).not.toBe(email);
      expect(row.emailHash).not.toBe(
        createHash('sha256').update(email).digest('hex'),
      );
    });

    it('keeps the counter row when the mail fails to send', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      transport.failNext = true;

      const res = await post({
        email: 'riverain@example.fr',
        communeCodes: ['30189'],
      });

      expect(res.statusCode).toBe(500);
      expect(transport.sent).toHaveLength(0);
      expect(await prisma.veilleFormEmail.count()).toBe(1);
    });

    it('refunds the attempt when the mail cannot be composed — a deterministic bug must stay loud, not burn the budget into silent 204s', async () => {
      await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
      const compose = jest
        .spyOn(app.get(MailComposer), 'compose')
        .mockImplementationOnce(() => {
          throw new MailCompositionError('composition broke');
        });

      const res = await post({
        email: 'riverain@example.fr',
        communeCodes: ['30189'],
      });
      compose.mockRestore();

      expect(res.statusCode).toBe(500);
      expect(transport.sent).toHaveLength(0);
      expect(await prisma.veilleFormEmail.count()).toBe(0);
    });
  });
});
