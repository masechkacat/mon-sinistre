import { createHash } from 'node:crypto';

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import { ACCOUNT_RESET_PATH } from '@mon-sinistre/contracts';
import { createIntTestApp } from 'src/app.int-helper';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { tokenFrom } from 'src/mail/mail-links.test-helper';
import { MAIL_TRANSPORT } from 'src/mail/mail-transport';
import { RecordingTransport } from 'src/mail/mail-transport.test-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { createUser as createUserIn } from './session.test-helper';

describe('POST /auth/password-reset (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let transport: RecordingTransport;
  let throttler: ThrottlerStorageService;
  const logs = captureLogs();

  const post = (body: object) =>
    app.inject({ method: 'POST', url: '/auth/password-reset', payload: body });

  const createUser = (overrides?: Parameters<typeof createUserIn>[1]) =>
    createUserIn(prisma, overrides);

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
    // The file shares one IP across more submissions than a person would
    // make — why: `register.int-spec.ts`, same reason.
    throttler.storage.clear();
    await prisma.$executeRaw`TRUNCATE TABLE "User", "PasswordReset", "AccountFormEmail" CASCADE`;
  });

  it('answers an existing address and a nonexistent one identically', async () => {
    const email = await createUser();

    const existing = await post({ email });
    const unknown = await post({ email: 'no-such-account@example.fr' });

    expect(existing.statusCode).toBe(204);
    expect(existing.statusCode).toBe(unknown.statusCode);
    expect(existing.payload).toBe(unknown.payload);
  });

  it('mails a reset link only to the existing address, with a hashed token in the database', async () => {
    const email = await createUser();

    await post({ email });
    await post({ email: 'no-such-account@example.fr' });

    expect(transport.sent).toHaveLength(1);
    const [message] = transport.sent;
    if (!message) throw new Error('expected a message to have been sent');
    expect(message.to).toBe(email);

    const reset = await prisma.passwordReset.findFirstOrThrow();
    const resetToken = tokenFrom(message, ACCOUNT_RESET_PATH);
    expect(reset.tokenHash).toBe(
      createHash('sha256').update(resetToken).digest('hex'),
    );
    // The database holds the hash, never the token that went out in the link.
    expect(reset.tokenHash).not.toBe(resetToken);
    expect(reset.usedAt).toBeNull();
  });

  it('creates no row and sends no mail for a nonexistent address', async () => {
    await post({ email: 'no-such-account@example.fr' });

    expect(await prisma.passwordReset.findMany()).toEqual([]);
    expect(transport.sent).toEqual([]);
  });

  it('mails an unconfirmed account too — its own confirmation link is a separate flow', async () => {
    const email = await createUser({ confirmedAt: null });

    await post({ email });

    expect(transport.sent).toHaveLength(1);
    expect(await prisma.passwordReset.count()).toBe(1);
  });

  it('accepts a different spelling of the same address', async () => {
    const email = await createUser({ email: 'user@example.fr' });

    const res = await post({ email: ' User@Example.Fr ' });

    expect(res.statusCode).toBe(204);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe(email);
  });

  it('answers 500 when the mail fails; the retry mails a fresh link whose hash is in the database', async () => {
    const email = await createUser();
    transport.failNext = true;

    const failed = await post({ email });
    expect(failed.statusCode).toBe(500);

    const retried = await post({ email });
    expect(retried.statusCode).toBe(204);
    expect(transport.sent).toHaveLength(1);

    const [message] = transport.sent;
    if (!message) throw new Error('expected a message to have been sent');
    const resetToken = tokenFrom(message, ACCOUNT_RESET_PATH);
    const rows = await prisma.passwordReset.findMany();
    expect(rows.map((row) => row.tokenHash)).toContain(
      createHash('sha256').update(resetToken).digest('hex'),
    );
  });

  it('never logs the email address', async () => {
    const email = await createUser();

    await post({ email });
    await post({ email: 'no-such-account@example.fr' });

    logs.expectNoTraceOf(email, 'no-such-account@example.fr');
  });
});
