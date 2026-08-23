import {
  VEILLE_CHANGE_PATH,
  VEILLE_CHANGE_TTL_DAYS,
  VEILLE_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { mailLinksOf } from 'test/helpers/mail-links';
import { MailComposer } from 'src/mail/compose/mail-composer';
import { changeMailFor } from './veille-change-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

const CHANGE_TOKEN = 'change-token-123';
const UNSUBSCRIBE_TOKEN = 'unsubscribe-token-456';
const NEW_COMMUNES = [
  { name: 'Nîmes', departementName: 'Gard' },
  { name: 'Alès', departementName: 'Gard' },
];
const COMMUNES = ['Nîmes (Gard)', 'Alès (Gard)'];

// The builder the service calls, not a copy of it: a paragraph dropped from
// the real mail has to break this suite.
const changeInput = () =>
  changeMailFor(
    'destinataire@example.test',
    NEW_COMMUNES,
    CHANGE_TOKEN,
    UNSUBSCRIBE_TOKEN,
  );

describe('veille change mail (fr.mail.veille.change + contracts constants)', () => {
  // Оба набора целиком, а не toContain: лишняя ссылка в письме — вторая
  // отписка, чужой путь — иначе прошла бы незамеченной.
  it('carries exactly the change link and the footer unsubscribe link', () => {
    const message = composer().compose(changeInput());

    const changeUrl = `${FRONTEND_URL}${VEILLE_CHANGE_PATH}?token=${CHANGE_TOKEN}`;
    const unsubscribeUrl = `${FRONTEND_URL}${VEILLE_UNSUBSCRIBE_PATH}?token=${UNSUBSCRIBE_TOKEN}`;
    const links = new Set([changeUrl, unsubscribeUrl]);
    expect(mailLinksOf(message.text)).toEqual(links);
    expect(mailLinksOf(message.html)).toEqual(links);
    expect(message.text).toContain(fr.mail.veille.change.changeLink);
    expect(message.text).toContain(fr.mail.footer.unsubscribe);
  });

  it('lists every commune of the new composition', () => {
    const message = composer().compose(changeInput());

    for (const commune of COMMUNES) {
      expect(message.text).toContain(commune);
      expect(message.html).toContain(commune);
    }
  });

  it('states the delay in the words of VEILLE_CHANGE_TTL_DAYS', () => {
    const message = composer().compose(changeInput());

    expect(message.text).toContain(String(VEILLE_CHANGE_TTL_DAYS));
    expect(message.text).toContain(
      fr.mail.veille.change.expiresIn(String(VEILLE_CHANGE_TTL_DAYS)),
    );
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    // The body's length is already guaranteed by MailComposer itself
    // (mail-composer.spec.ts); only the subject is specific to this branch.
    const message = composer().compose(changeInput());

    expect(message.subject.trim().length).toBeGreaterThan(10);
  });
});
