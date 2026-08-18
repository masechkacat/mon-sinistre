import { VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { MailComposer } from 'src/mail/mail-composer';
import { monitorAlertMailFor } from './monitor-alert-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

describe('monitor alert mail (fr.mail.jorf.alert)', () => {
  it('names the alert kind and carries its detail', () => {
    const message = composer().compose(
      monitorAlertMailFor('admin@example.test', {
        kind: 'UNMATCHED_COMMUNE',
        detail:
          'NOR INTJ2600006A: Commune Fictive (Département Fictif) not matched to a commune',
      }),
    );

    expect(message.text).toContain(
      fr.mail.jorf.alert.kindLabel.UNMATCHED_COMMUNE,
    );
    expect(message.text).toContain('Commune Fictive');
    expect(message.html).toContain('Commune Fictive');
  });

  it('carries the unsubscribe link required of every message', () => {
    const message = composer().compose(
      monitorAlertMailFor('admin@example.test', {
        kind: 'OUTCOME_CHANGED',
        detail: 'NOR INTJ2600001A: Amigny-Rouy RECONNU → REFUSE',
      }),
    );

    const unsubscribeUrl = `${FRONTEND_URL}${VEILLE_UNSUBSCRIBE_PATH}`;
    expect(message.headers['List-Unsubscribe']).toBe(`<${unsubscribeUrl}>`);
    expect(message.text).toContain(fr.mail.footer.unsubscribe);
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    const message = composer().compose(
      monitorAlertMailFor('admin@example.test', {
        kind: 'UNPARSEABLE_ANNEXE',
        detail: 'text JORFTEXT000000000401: parse error',
      }),
    );

    expect(message.subject.trim().length).toBeGreaterThan(10);
  });
});
