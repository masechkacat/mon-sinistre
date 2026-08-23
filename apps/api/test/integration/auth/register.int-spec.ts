import { createHash } from 'node:crypto';

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import {
  ACCOUNT_CONFIRM_PATH,
  ACCOUNT_FORGOT_PASSWORD_PATH,
} from '@mon-sinistre/contracts';
import { createIntTestApp } from 'test/helpers/app';
import { DAY_MS } from 'src/common/time/time';
import { captureLogs } from 'test/helpers/mail-log';
import { mailLinksOf, tokenFrom } from 'test/helpers/mail-links';
import { MAIL_TRANSPORT } from 'src/mail/mail-transport';
import { RecordingTransport } from 'test/helpers/mail-transport';
import { PrismaService } from 'src/prisma/prisma.service';
import { AUTH_MAIL_RATE_LIMIT } from 'src/auth/auth.controller';
import { createUser } from 'test/helpers/session';

describe('POST /auth/register (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let transport: RecordingTransport;
  let throttler: ThrottlerStorageService;
  const logs = captureLogs();

  const post = (body: object) =>
    app.inject({ method: 'POST', url: '/auth/register', payload: body });

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
    // Every spec below but the rate-limit one submits the form more often
    // than a person would: `AUTH_MAIL_RATE_LIMIT` counts per IP, and the
    // whole file shares one.
    throttler.storage.clear();
    await prisma.$executeRaw`TRUNCATE TABLE "User", "AccountFormEmail" CASCADE`;
  });

  it('creates an unconfirmed account, hashes the password and mails the confirmation link with its token', async () => {
    const res = await post({
      email: 'victime@example.fr',
      password: 'Abc12345',
    });

    expect(res.statusCode).toBe(204);

    const user = await prisma.user.findFirstOrThrow();
    expect(user.confirmedAt).toBeNull();
    expect(user.passwordHash).not.toBe('Abc12345');
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);

    expect(transport.sent).toHaveLength(1);
    const [message] = transport.sent;
    if (!message) throw new Error('expected a message to have been sent');

    const confirmToken = tokenFrom(message, ACCOUNT_CONFIRM_PATH);
    expect(user.confirmTokenHash).toBe(
      createHash('sha256').update(confirmToken).digest('hex'),
    );
    // The database holds the hash, never the token that went out in the link.
    expect(user.confirmTokenHash).not.toBe(confirmToken);
  });

  it('keeps the account when the confirmation mail fails; the retry rotates the token and mails a working link', async () => {
    const body = { email: 'victime@example.fr', password: 'Abc12345' };
    transport.failNext = true;

    const failed = await post(body);
    expect(failed.statusCode).toBe(500);
    expect(await prisma.user.count()).toBe(1);

    const retried = await post(body);
    expect(retried.statusCode).toBe(204);
    expect(await prisma.user.count()).toBe(1);
    expect(transport.sent).toHaveLength(1);

    const [message] = transport.sent;
    if (!message) throw new Error('expected a message to have been sent');
    const user = await prisma.user.findFirstOrThrow();
    const confirmToken = tokenFrom(message, ACCOUNT_CONFIRM_PATH);
    expect(user.confirmTokenHash).toBe(
      createHash('sha256').update(confirmToken).digest('hex'),
    );
  });

  it('creates exactly one account for two spellings of the same address, the last password winning', async () => {
    const first = await post({
      email: ' User@Example.Fr ',
      password: 'Abc12345',
    });
    const second = await post({
      email: 'user@example.fr',
      password: 'Def!67890',
    });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);

    const rows = await prisma.user.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('user@example.fr');
    expect(await bcrypt.compare('Def!67890', rows[0]?.passwordHash ?? '')).toBe(
      true,
    );
    // The second submission hits the address already on file, still
    // unconfirmed: it rewrites the row and resends the confirmation mail.
    expect(transport.sent).toHaveLength(2);
  });

  describe('re-registration of an unconfirmed address', () => {
    it('rewrites the password, extends the deadline and mails a fresh confirmation link, without creating a second account', async () => {
      const email = 'victime@example.fr';
      const staleDeadline = new Date(Date.now() - DAY_MS);
      await createUser(prisma, {
        email,
        confirmedAt: null,
        confirmTokenHash: 'stale-hash',
        confirmExpiresAt: staleDeadline,
      });

      const res = await post({ email, password: 'Def!67890' });

      expect(res.statusCode).toBe(204);
      expect(await prisma.user.count()).toBe(1);

      const user = await prisma.user.findFirstOrThrow();
      expect(user.confirmedAt).toBeNull();
      expect(await bcrypt.compare('Def!67890', user.passwordHash)).toBe(true);
      expect(user.confirmExpiresAt.getTime()).toBeGreaterThan(
        staleDeadline.getTime(),
      );
      expect(user.confirmTokenHash).not.toBe('stale-hash');

      expect(transport.sent).toHaveLength(1);
      const [message] = transport.sent;
      if (!message) throw new Error('expected a message to have been sent');
      const confirmToken = tokenFrom(message, ACCOUNT_CONFIRM_PATH);
      expect(user.confirmTokenHash).toBe(
        createHash('sha256').update(confirmToken).digest('hex'),
      );
    });

    it('never logs the email address or the password on re-registration', async () => {
      const email = 'victime@example.fr';
      await createUser(prisma, { email, confirmedAt: null });

      await post({ email, password: 'Def!67890' });

      logs.expectNoTraceOf(email, 'Def!67890');
    });
  });

  describe('re-registration of a confirmed address', () => {
    it('leaves the account and its password untouched, and answers identically to a brand-new address', async () => {
      const email = await createUser(prisma, { email: 'victime@example.fr' });
      const before = await prisma.user.findUniqueOrThrow({ where: { email } });

      const confirmed = await post({ email, password: 'Def!67890' });
      const brandNew = await post({
        email: 'nouvelle@example.fr',
        password: 'Def!67890',
      });

      expect(confirmed.statusCode).toBe(204);
      expect(confirmed.statusCode).toBe(brandNew.statusCode);
      expect(confirmed.payload).toBe(brandNew.payload);

      const after = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.confirmedAt).toEqual(before.confirmedAt);
    });

    it('mails "vous avez déjà un compte" with a password-reset request link, carrying no token', async () => {
      const email = await createUser(prisma, { email: 'victime@example.fr' });

      await post({ email, password: 'Def!67890' });

      expect(transport.sent).toHaveLength(1);
      const [message] = transport.sent;
      if (!message) throw new Error('expected a message to have been sent');
      expect(message.to).toBe(email);

      const requestLink = [...mailLinksOf(message.text)].find((link) =>
        link.includes(ACCOUNT_FORGOT_PASSWORD_PATH),
      );
      if (!requestLink) {
        throw new Error(
          `no link containing "${ACCOUNT_FORGOT_PASSWORD_PATH}" in the mail`,
        );
      }
      expect(new URL(requestLink).searchParams.has('token')).toBe(false);
    });

    it('never logs the email address or the password', async () => {
      const email = await createUser(prisma, { email: 'victime@example.fr' });

      await post({ email, password: 'Def!67890' });

      logs.expectNoTraceOf(email, 'Def!67890');
    });
  });

  it('stops mailing further addresses once one caller passes the per-IP rate limit', async () => {
    const submit = (n: number) =>
      post({ email: `victime${n}@example.fr`, password: 'Abc12345' });

    for (let i = 0; i < AUTH_MAIL_RATE_LIMIT.limit; i++) {
      expect((await submit(i)).statusCode).toBe(204);
    }
    const refused = await submit(AUTH_MAIL_RATE_LIMIT.limit);

    // The per-address counter never sees these: each address is a different
    // one, which is exactly what the IP limit is for.
    expect(refused.statusCode).toBe(429);
    expect(transport.sent).toHaveLength(AUTH_MAIL_RATE_LIMIT.limit);
  });

  it('rejects a password that does not meet the CNIL policy with a 400', async () => {
    const res = await post({
      email: 'victime@example.fr',
      password: 'tooweak',
    });

    expect(res.statusCode).toBe(400);
    expect(await prisma.user.findMany()).toEqual([]);
    expect(transport.sent).toEqual([]);
  });

  it('never logs the email address or the password', async () => {
    await post({ email: 'victime@example.fr', password: 'Abc12345' });

    logs.expectNoTraceOf('victime@example.fr', 'Abc12345');
  });
});
