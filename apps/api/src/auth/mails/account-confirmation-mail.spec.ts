import {
  ACCOUNT_CONFIRM_PATH,
  ACCOUNT_CONFIRM_TTL_DAYS,
  ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { mailLinksOf } from 'test/helpers/mail-links';
import { MailComposer } from 'src/mail/compose/mail-composer';
import { confirmationMailFor } from './account-confirmation-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

const CONFIRM_TOKEN = 'confirm-token-123';

// The builder the service calls, not a copy of it: a paragraph dropped from
// the real mail has to break this suite.
const confirmationInput = () =>
  confirmationMailFor('destinataire@example.test', CONFIRM_TOKEN);

describe('account confirmation mail (fr.mail.account + contracts constants)', () => {
  it('carries the confirmation link with its token', () => {
    const message = composer().compose(confirmationInput());

    const confirmUrl = `${FRONTEND_URL}${ACCOUNT_CONFIRM_PATH}?token=${CONFIRM_TOKEN}`;
    expect(mailLinksOf(message.text)).toContain(confirmUrl);
    expect(mailLinksOf(message.html)).toContain(confirmUrl);
    expect(message.text).toContain(fr.mail.account.confirmation.confirmLink);
  });

  it('carries the mandatory unsubscribe link, pointed at the dedicated one-click path', () => {
    const message = composer().compose(confirmationInput());

    const unsubscribeUrl = `${FRONTEND_URL}${ACCOUNT_MAIL_UNSUBSCRIBE_PATH}`;
    expect(mailLinksOf(message.text)).toContain(unsubscribeUrl);
    expect(mailLinksOf(message.html)).toContain(unsubscribeUrl);
    expect(message.text).toContain(fr.mail.footer.unsubscribe);
  });

  it('states the delay in the words of ACCOUNT_CONFIRM_TTL_DAYS', () => {
    const message = composer().compose(confirmationInput());

    expect(message.text).toContain(String(ACCOUNT_CONFIRM_TTL_DAYS));
    expect(message.text).toContain(
      fr.mail.account.confirmation.expiresIn(String(ACCOUNT_CONFIRM_TTL_DAYS)),
    );
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    // The body's length is already guaranteed by MailComposer itself
    // (mail-composer.spec.ts); only the subject is specific to this branch.
    const message = composer().compose(confirmationInput());

    expect(message.subject.trim().length).toBeGreaterThan(10);
  });
});
