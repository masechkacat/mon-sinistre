import {
  ACCOUNT_FORGOT_PASSWORD_PATH,
  ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { mailLinksOf } from 'src/mail/mail-links.test-helper';
import { MailComposer } from 'src/mail/mail-composer';
import { alreadyRegisteredMailFor } from './account-already-registered-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

// The builder the service calls, not a copy of it: a paragraph dropped from
// the real mail has to break this suite.
const alreadyRegisteredInput = () =>
  alreadyRegisteredMailFor('destinataire@example.test');

describe('already-registered mail (fr.mail.account.alreadyRegistered + contracts constants)', () => {
  it('carries the password-reset request link, without a token', () => {
    const message = composer().compose(alreadyRegisteredInput());

    const requestUrl = `${FRONTEND_URL}${ACCOUNT_FORGOT_PASSWORD_PATH}`;
    expect(mailLinksOf(message.text)).toContain(requestUrl);
    expect(mailLinksOf(message.html)).toContain(requestUrl);
    expect(message.text).toContain(
      fr.mail.account.alreadyRegistered.resetRequestLink,
    );
  });

  it('carries the mandatory unsubscribe link, pointed at the dedicated one-click path', () => {
    const message = composer().compose(alreadyRegisteredInput());

    const unsubscribeUrl = `${FRONTEND_URL}${ACCOUNT_MAIL_UNSUBSCRIBE_PATH}`;
    expect(mailLinksOf(message.text)).toContain(unsubscribeUrl);
    expect(mailLinksOf(message.html)).toContain(unsubscribeUrl);
    expect(message.text).toContain(fr.mail.footer.unsubscribe);
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    // The body's length is already guaranteed by MailComposer itself
    // (mail-composer.spec.ts); only the subject is specific to this branch.
    const message = composer().compose(alreadyRegisteredInput());

    expect(message.subject.trim().length).toBeGreaterThan(10);
  });
});
