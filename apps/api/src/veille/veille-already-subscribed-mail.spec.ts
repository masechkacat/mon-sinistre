import { VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { mailLinksOf } from 'src/mail/mail-links.test-helper';
import { MailComposer } from 'src/mail/mail-composer';
import { alreadySubscribedMailFor } from './veille-already-subscribed-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

const UNSUBSCRIBE_TOKEN = 'unsubscribe-token-789';
const CHOSEN = [
  { name: 'Nîmes', departementName: 'Gard' },
  { name: 'Alès', departementName: 'Gard' },
];
const COMMUNES = ['Nîmes (Gard)', 'Alès (Gard)'];

// The builder the service calls, not a copy of it.
const alreadySubscribedInput = () =>
  alreadySubscribedMailFor(
    'destinataire@example.test',
    CHOSEN,
    UNSUBSCRIBE_TOKEN,
  );

describe('veille "déjà inscrit·e" mail (fr.mail.veille.alreadySubscribed)', () => {
  it('lists the communes of the active subscription', () => {
    const message = composer().compose(alreadySubscribedInput());

    for (const commune of COMMUNES) {
      expect(message.text).toContain(commune);
      expect(message.html).toContain(commune);
    }
    expect(message.text).toContain(fr.mail.veille.alreadySubscribed.intro);
  });

  it('carries the unsubscribe link only in the footer, not a second time in the body', () => {
    const message = composer().compose(alreadySubscribedInput());

    const unsubscribeUrl = `${FRONTEND_URL}${VEILLE_UNSUBSCRIBE_PATH}?token=${UNSUBSCRIBE_TOKEN}`;
    expect(mailLinksOf(message.text)).toEqual(new Set([unsubscribeUrl]));
    expect(mailLinksOf(message.html)).toEqual(new Set([unsubscribeUrl]));
    expect(message.text).toContain(fr.mail.footer.unsubscribe);
  });

  it('does not offer a confirmation link — there is nothing left to confirm', () => {
    const message = composer().compose(alreadySubscribedInput());

    expect(message.text).not.toContain(fr.mail.veille.confirmation.confirmLink);
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    const message = composer().compose(alreadySubscribedInput());

    expect(message.subject.trim().length).toBeGreaterThan(10);
  });
});
