import {
  ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
  ACCOUNT_RESET_PATH,
  PASSWORD_RESET_TTL_HOURS,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { mailLinksOf } from 'test/helpers/mail-links';
import { MailComposer } from 'src/mail/mail-composer';
import { passwordResetMailFor } from './password-reset-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

const RESET_TOKEN = 'reset-token-123';

// The builder the service calls, not a copy of it: a paragraph dropped from
// the real mail has to break this suite.
const resetInput = () =>
  passwordResetMailFor('destinataire@example.test', RESET_TOKEN);

describe('password reset mail (fr.mail.account.passwordReset + contracts constants)', () => {
  it('carries the reset link with its token', () => {
    const message = composer().compose(resetInput());

    const resetUrl = `${FRONTEND_URL}${ACCOUNT_RESET_PATH}?token=${RESET_TOKEN}`;
    expect(mailLinksOf(message.text)).toContain(resetUrl);
    expect(mailLinksOf(message.html)).toContain(resetUrl);
    expect(message.text).toContain(fr.mail.account.passwordReset.resetLink);
  });

  it('carries the mandatory unsubscribe link, pointed at the dedicated one-click path', () => {
    const message = composer().compose(resetInput());

    const unsubscribeUrl = `${FRONTEND_URL}${ACCOUNT_MAIL_UNSUBSCRIBE_PATH}`;
    expect(mailLinksOf(message.text)).toContain(unsubscribeUrl);
    expect(mailLinksOf(message.html)).toContain(unsubscribeUrl);
    expect(message.text).toContain(fr.mail.footer.unsubscribe);
  });

  it('states the delay in the words of PASSWORD_RESET_TTL_HOURS', () => {
    const message = composer().compose(resetInput());

    expect(message.text).toContain(String(PASSWORD_RESET_TTL_HOURS));
    expect(message.text).toContain(
      fr.mail.account.passwordReset.expiresIn(String(PASSWORD_RESET_TTL_HOURS)),
    );
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    // The body's length is already guaranteed by MailComposer itself
    // (mail-composer.spec.ts); only the subject is specific to this branch.
    const message = composer().compose(resetInput());

    expect(message.subject.trim().length).toBeGreaterThan(10);
  });
});
