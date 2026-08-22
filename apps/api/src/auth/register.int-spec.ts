import { createHash } from 'node:crypto';

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ACCOUNT_CONFIRM_PATH } from '@mon-sinistre/contracts';
import { createIntTestApp } from 'src/app.int-helper';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { tokenFrom } from 'src/mail/mail-links.test-helper';
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

describe('POST /auth/register (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let transport: RecordingTransport;
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    transport.sent.length = 0;
    await prisma.$executeRaw`TRUNCATE TABLE "User" CASCADE`;
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

  it('creates exactly one account for two spellings of the same address', async () => {
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
    // The second submission hits the address already on file: rewriting its
    // password and resending mail is docs/plan/user-account.md phase 3.
    expect(transport.sent).toHaveLength(1);
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
