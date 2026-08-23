import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import {
  ACCOUNT_CONFIRM_PATH,
  ACCOUNT_EMAIL_LIMIT,
  ACCOUNT_REGISTRATION_MAIL_LIMIT,
  VEILLE_FORM_EMAIL_DAILY_LIMIT,
} from '@mon-sinistre/contracts';
import { createIntTestApp } from 'test/helpers/app';
import { tokenFrom } from 'test/helpers/mail-links';
import { MAIL_TRANSPORT } from 'src/mail/mail-transport';
import { RecordingTransport } from 'test/helpers/mail-transport';
import { PrismaService } from 'src/prisma/prisma.service';
import { communeFixture } from 'test/helpers/veille';

describe('account mail rate limit (ACCOUNT_EMAIL_LIMIT)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let transport: RecordingTransport;
  let throttler: ThrottlerStorageService;

  // Both helpers clear the per-IP throttler first: `AUTH_MAIL_RATE_LIMIT`
  // would otherwise answer 429 before the per-address counter under test ever
  // ran, and it has its own spec (`register.int-spec.ts`).
  const register = (email: string) => {
    throttler.storage.clear();
    return app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'Abc12345' },
    });
  };

  const requestPasswordReset = (email: string) => {
    throttler.storage.clear();
    return app.inject({
      method: 'POST',
      url: '/auth/password-reset',
      payload: { email },
    });
  };

  /** The whole daily budget: the registration share, then resets for the rest. */
  const exhaustDailyLimit = async (email: string) => {
    for (let i = 0; i < ACCOUNT_REGISTRATION_MAIL_LIMIT; i++) {
      await register(email);
    }
    for (
      let i = ACCOUNT_REGISTRATION_MAIL_LIMIT;
      i < ACCOUNT_EMAIL_LIMIT;
      i++
    ) {
      await requestPasswordReset(email);
    }
  };

  const subscribe = (email: string) => {
    throttler.storage.clear();
    return app.inject({
      method: 'POST',
      url: '/veille',
      payload: { email, communeCodes: ['30189'] },
    });
  };

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
    await prisma.$executeRaw`TRUNCATE TABLE "User", "PasswordReset", "AccountFormEmail", "Veille", "Commune", "VeilleFormEmail" CASCADE`;
    await prisma.commune.create({ data: communeFixture('30189', 'Nîmes') });
  });

  it('suppresses a registration mail past its share of the daily limit; the form still answers normally', async () => {
    const email = 'victime@example.fr';

    for (let i = 0; i < ACCOUNT_REGISTRATION_MAIL_LIMIT; i++) {
      const res = await register(email);
      expect(res.statusCode).toBe(204);
    }
    expect(transport.sent).toHaveLength(ACCOUNT_REGISTRATION_MAIL_LIMIT);

    const refused = await register(email);

    expect(refused.statusCode).toBe(204);
    expect(transport.sent).toHaveLength(ACCOUNT_REGISTRATION_MAIL_LIMIT);
    expect(await prisma.accountFormEmail.count()).toBe(
      ACCOUNT_REGISTRATION_MAIL_LIMIT,
    );
  });

  it('leaves the last mailed confirmation link working when the mail that would have rotated it is suppressed', async () => {
    const email = 'victime@example.fr';

    for (let i = 0; i < ACCOUNT_REGISTRATION_MAIL_LIMIT; i++) {
      await register(email);
    }
    const lastMailed = transport.sent.at(-1);
    if (!lastMailed) throw new Error('expected a message to have been sent');
    const token = tokenFrom(lastMailed, ACCOUNT_CONFIRM_PATH);

    // The suppressed registration rotates nothing — the previous link is all
    // the person has, and it still activates the account.
    await register(email);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/confirmation',
      payload: { token },
    });
    expect(JSON.parse(res.payload)).toEqual({ status: 'confirmed' });
  });

  it('still mails a password reset once registration mails have taken their share', async () => {
    const email = 'victime@example.fr';

    for (let i = 0; i < ACCOUNT_REGISTRATION_MAIL_LIMIT; i++) {
      await register(email);
    }
    expect(transport.sent).toHaveLength(ACCOUNT_REGISTRATION_MAIL_LIMIT);

    await requestPasswordReset(email);

    expect(transport.sent).toHaveLength(ACCOUNT_REGISTRATION_MAIL_LIMIT + 1);
  });

  it('counts every account mail kind toward the same daily limit, not one per kind', async () => {
    const email = 'victime@example.fr';

    await exhaustDailyLimit(email);
    expect(transport.sent).toHaveLength(ACCOUNT_EMAIL_LIMIT);

    const blocked = await requestPasswordReset(email);

    expect(blocked.statusCode).toBe(204);
    expect(transport.sent).toHaveLength(ACCOUNT_EMAIL_LIMIT);
    expect(await prisma.accountFormEmail.count()).toBe(ACCOUNT_EMAIL_LIMIT);
  });

  it('does not count account mails exhausted at the account limit against a veille mail to the same address', async () => {
    const email = 'victime@example.fr';

    await exhaustDailyLimit(email);
    expect(transport.sent).toHaveLength(ACCOUNT_EMAIL_LIMIT);

    const veilleMail = await subscribe(email);

    expect(veilleMail.statusCode).toBe(204);
    expect(transport.sent).toHaveLength(ACCOUNT_EMAIL_LIMIT + 1);
  });

  it('does not count veille mails exhausted at the veille limit against an account mail to the same address', async () => {
    const email = 'riverain@example.fr';

    for (let i = 0; i < VEILLE_FORM_EMAIL_DAILY_LIMIT; i++) {
      const res = await subscribe(email);
      expect(res.statusCode).toBe(204);
    }
    expect(transport.sent).toHaveLength(VEILLE_FORM_EMAIL_DAILY_LIMIT);

    const accountMail = await register(email);

    expect(accountMail.statusCode).toBe(204);
    expect(transport.sent).toHaveLength(VEILLE_FORM_EMAIL_DAILY_LIMIT + 1);
  });
});
