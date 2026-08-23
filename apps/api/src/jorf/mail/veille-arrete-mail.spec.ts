import { toIsoDate, VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { mailLinksOf } from 'test/helpers/mail-links';
import { MailComposer } from 'src/mail/compose/mail-composer';
import {
  type ArreteEntryForMail,
  type ArreteForMail,
  veilleArreteMailFor,
} from './veille-arrete-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

const UNSUBSCRIBE_TOKEN = 'unsubscribe-token-456';

const ARRETE: ArreteForMail = {
  publishedAt: toIsoDate('2026-06-12'),
  legifranceUrl: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054245373',
};

const DECLARATION_RULE = { duration: 30, unit: 'DAYS' as const };

const nimesReconnu: ArreteEntryForMail = {
  commune: { name: 'Nîmes', departementName: 'Gard' },
  risque: 'Inondations et coulées de boue',
  eventStart: toIsoDate('2026-06-01'),
  eventEnd: toIsoDate('2026-06-02'),
  outcome: 'RECONNU',
};

const alesRefuse: ArreteEntryForMail = {
  commune: { name: 'Alès', departementName: 'Gard' },
  risque: 'Inondations et coulées de boue',
  eventStart: toIsoDate('2026-06-01'),
  eventEnd: toIsoDate('2026-06-02'),
  outcome: 'REFUSE',
};

const mailFor = (entries: readonly ArreteEntryForMail[]) =>
  composer().compose(
    veilleArreteMailFor(
      'destinataire@example.test',
      UNSUBSCRIBE_TOKEN,
      ARRETE,
      entries,
      DECLARATION_RULE,
    ),
  );

describe('veille arrête mail (fr.mail.jorf.notification)', () => {
  it('names the commune, the risque, the period and the outcome of every entry', () => {
    const message = mailFor([nimesReconnu, alesRefuse]);

    expect(message.text).toContain('Nîmes (Gard)');
    expect(message.text).toContain('Alès (Gard)');
    expect(message.text).toContain('Inondations et coulées de boue');
    expect(message.text).toContain('01/06/2026');
    expect(message.text).toContain('02/06/2026');
    expect(message.text).toContain(
      fr.mail.jorf.notification.outcomeLabel.RECONNU,
    );
    expect(message.text).toContain(
      fr.mail.jorf.notification.outcomeLabel.REFUSE,
    );
  });

  it('carries the publication date', () => {
    const message = mailFor([nimesReconnu]);

    expect(message.text).toContain('12/06/2026');
  });

  it('links to the arrêté on Légifrance, off-site, in both versions', () => {
    const message = mailFor([nimesReconnu]);

    expect(mailLinksOf(message.text)).toContain(ARRETE.legifranceUrl);
    expect(mailLinksOf(message.html)).toContain(ARRETE.legifranceUrl);
    expect(message.text).toContain(fr.mail.jorf.notification.legifranceLink);
  });

  it('renders the same set of links in text and HTML', () => {
    const message = mailFor([nimesReconnu, alesRefuse]);

    expect(mailLinksOf(message.text)).toEqual(mailLinksOf(message.html));
  });

  it('carries the unsubscribe link required of every message', () => {
    const message = mailFor([nimesReconnu]);

    const unsubscribeUrl = `${FRONTEND_URL}${VEILLE_UNSUBSCRIBE_PATH}?token=${UNSUBSCRIBE_TOKEN}`;
    expect(mailLinksOf(message.text)).toContain(unsubscribeUrl);
    expect(message.headers['List-Unsubscribe']).toBe(`<${unsubscribeUrl}>`);
  });

  describe('reconnu', () => {
    it('carries the declaration deadline resolved from the DeadlineRule', () => {
      const message = mailFor([nimesReconnu]);

      // 12/06/2026 + 30 DAYS — resolve-deadline.spec.ts covers the arithmetic
      // itself, this only checks the mail carries what it returns.
      expect(message.text).toContain('12/07/2026');
      expect(message.text).toContain(
        fr.mail.jorf.notification.deadline('12/07/2026'),
      );
    });
  });

  describe('refusé', () => {
    it('names the refusal and carries no deadline at all', () => {
      const message = mailFor([alesRefuse]);

      expect(message.text).toContain(
        fr.mail.jorf.notification.outcomeLabel.REFUSE,
      );
      // No DAYS/MONTHS arithmetic ran: neither the resolved date nor the
      // deadline sentence appears anywhere in a refusé-only mail.
      expect(message.text).toContain('demande refusée');
      expect(message.text).not.toContain('12/07/2026');
      expect(message.text).not.toMatch(/délai légal/);
    });
  });

  it('lists every commune of a mixed outcome in one message', () => {
    const message = mailFor([nimesReconnu, alesRefuse]);

    // The recognised commune's deadline still appears even though the
    // message also carries a refused one.
    expect(message.text).toContain('12/07/2026');
    expect(message.text).toContain('Nîmes (Gard)');
    expect(message.text).toContain('Alès (Gard)');
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    const message = mailFor([nimesReconnu]);

    expect(message.subject.trim().length).toBeGreaterThan(10);
  });
});
