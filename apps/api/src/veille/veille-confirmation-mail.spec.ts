import {
  VEILLE_CONFIRM_PATH,
  VEILLE_CONFIRM_TTL_DAYS,
  VEILLE_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { mailLinksOf } from 'test/helpers/mail-links';
import { MailComposer } from 'src/mail/mail-composer';
import { confirmationMailFor } from './veille-confirmation-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

const CONFIRM_TOKEN = 'confirm-token-123';
const UNSUBSCRIBE_TOKEN = 'unsubscribe-token-456';
const CHOSEN = [
  { name: 'Nîmes', departementName: 'Gard' },
  { name: 'Alès', departementName: 'Gard' },
];
const COMMUNES = ['Nîmes (Gard)', 'Alès (Gard)'];

// The builder the service calls, not a copy of it: a paragraph dropped from
// the real mail has to break this suite.
const confirmationInput = () =>
  confirmationMailFor(
    'destinataire@example.test',
    CHOSEN,
    CONFIRM_TOKEN,
    UNSUBSCRIBE_TOKEN,
  );

describe('veille confirmation mail (fr.mail.veille + contracts constants)', () => {
  it('carries the confirmation link with its token', () => {
    const message = composer().compose(confirmationInput());

    const confirmUrl = `${FRONTEND_URL}${VEILLE_CONFIRM_PATH}?token=${CONFIRM_TOKEN}`;
    expect(mailLinksOf(message.text)).toContain(confirmUrl);
    expect(mailLinksOf(message.html)).toContain(confirmUrl);
    expect(message.text).toContain(fr.mail.veille.confirmation.confirmLink);
  });

  it('carries the unsubscribe link in the footer', () => {
    const message = composer().compose(confirmationInput());

    const unsubscribeUrl = `${FRONTEND_URL}${VEILLE_UNSUBSCRIBE_PATH}?token=${UNSUBSCRIBE_TOKEN}`;
    expect(mailLinksOf(message.text)).toContain(unsubscribeUrl);
    expect(mailLinksOf(message.html)).toContain(unsubscribeUrl);
    expect(message.text).toContain(fr.mail.footer.unsubscribe);
  });

  it('lists every chosen commune', () => {
    const message = composer().compose(confirmationInput());

    for (const commune of COMMUNES) {
      expect(message.text).toContain(commune);
      expect(message.html).toContain(commune);
    }
  });

  it('states the delay in the words of VEILLE_CONFIRM_TTL_DAYS', () => {
    const message = composer().compose(confirmationInput());

    expect(message.text).toContain(String(VEILLE_CONFIRM_TTL_DAYS));
    expect(message.text).toContain(
      fr.mail.veille.confirmation.expiresIn(String(VEILLE_CONFIRM_TTL_DAYS)),
    );
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    // The body's length is already guaranteed by MailComposer itself
    // (mail-composer.spec.ts); only the subject is specific to this branch.
    const message = composer().compose(confirmationInput());

    expect(message.subject.trim().length).toBeGreaterThan(10);
  });
});
