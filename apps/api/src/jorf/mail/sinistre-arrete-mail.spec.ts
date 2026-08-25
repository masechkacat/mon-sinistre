import {
  ACCOUNT_MAIL_UNSUBSCRIBE_PATH,
  SINISTRE_PATH,
  toIsoDate,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { mailLinksOf } from 'test/helpers/mail-links';
import { MailComposer } from 'src/mail/compose/mail-composer';
import { sinistreArreteMailFor } from './sinistre-arrete-mail';
import type { ArreteForMail } from './veille-arrete-mail';
import type { ChosenCommune } from 'src/veille/veille-confirmation-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';
const RECIPIENT = 'destinataire@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

const NIMES: ChosenCommune = { name: 'Nîmes', departementName: 'Gard' };
const RISQUE = 'Inondations et coulées de boue';

const ARRETE: ArreteForMail = {
  publishedAt: toIsoDate('2026-06-12'),
  legifranceUrl: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054245373',
};

const DECLARATION_RULE = { duration: 30, unit: 'DAYS' as const };

const mailFor = () =>
  composer().compose(
    sinistreArreteMailFor(RECIPIENT, NIMES, RISQUE, ARRETE, DECLARATION_RULE),
  );

describe('sinistre arrête mail (fr.mail.jorf.sinistreNotification)', () => {
  it('names the commune and the risque of the sinistre', () => {
    const message = mailFor();

    expect(message.text).toContain('Nîmes (Gard)');
    expect(message.text).toContain(RISQUE);
  });

  it('carries the publication date', () => {
    const message = mailFor();

    expect(message.text).toContain('12/06/2026');
  });

  it('carries the declaration deadline resolved from the DeadlineRule', () => {
    const message = mailFor();

    // 12/06/2026 + 30 DAYS — resolve-deadline.spec.ts covers the arithmetic
    // itself, this only checks the mail carries what it returns.
    expect(message.text).toContain('12/07/2026');
    expect(message.text).toContain(
      fr.mail.jorf.notification.deadline('12/07/2026'),
    );
  });

  it('links to the sinistre screen, built from FRONTEND_URL + SINISTRE_PATH', () => {
    const message = mailFor();

    expect(mailLinksOf(message.text)).toContain(
      `${FRONTEND_URL}${SINISTRE_PATH}`,
    );
  });

  it('links to the arrêté on Légifrance, off-site, in both versions', () => {
    const message = mailFor();

    expect(mailLinksOf(message.text)).toContain(ARRETE.legifranceUrl);
    expect(mailLinksOf(message.html)).toContain(ARRETE.legifranceUrl);
  });

  it('renders the same set of links in text and HTML', () => {
    const message = mailFor();

    expect(mailLinksOf(message.text)).toEqual(mailLinksOf(message.html));
  });

  it('unsubscribes through the transactional account handler, not veille', () => {
    const message = mailFor();

    const unsubscribeUrl = `${FRONTEND_URL}${ACCOUNT_MAIL_UNSUBSCRIBE_PATH}`;
    expect(mailLinksOf(message.text)).toContain(unsubscribeUrl);
    expect(message.headers['List-Unsubscribe']).toBe(`<${unsubscribeUrl}>`);
    // No rotating subscription token: an account unsubscribe carries none.
    expect(message.text).not.toContain('token=');
  });

  it('carries no address other than the recipient — one owner, not a list', () => {
    const message = mailFor();

    expect(message.to).toBe(RECIPIENT);
    expect(message.text).not.toMatch(/@/);
  });

  it('does not tell the reader they have already declared to their insurer', () => {
    // Единственный дедлайн письма — та самая декларация страховщику; сказать
    // «vous avez déclaré» значит объявить её выполненной.
    expect(mailFor().text).not.toMatch(/déclaré/i);
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    const message = mailFor();

    expect(message.subject.trim().length).toBeGreaterThan(10);
  });
});
