import { VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { MailComposer } from 'src/mail/compose/mail-composer';
import { MAX_ALERTS_DETAILED, monitorAlertMailFor } from './monitor-alert-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

describe('monitor alert mail (fr.mail.jorf.alert)', () => {
  it('names the alert kind and carries its detail', () => {
    const message = composer().compose(
      monitorAlertMailFor('admin@example.test', [
        {
          kind: 'UNMATCHED_COMMUNE',
          detail:
            'NOR INTJ2600006A: Commune Fictive (Département Fictif) not matched to a commune',
        },
      ]),
    );

    expect(message.text).toContain(
      fr.mail.jorf.alert.kindLabel.UNMATCHED_COMMUNE,
    );
    expect(message.text).toContain('Commune Fictive');
    expect(message.html).toContain('Commune Fictive');
  });

  it('carries the unsubscribe link required of every message', () => {
    const message = composer().compose(
      monitorAlertMailFor('admin@example.test', [
        {
          kind: 'OUTCOME_CHANGED',
          detail: 'NOR INTJ2600001A: Amigny-Rouy RECONNU → REFUSE',
        },
      ]),
    );

    const unsubscribeUrl = `${FRONTEND_URL}${VEILLE_UNSUBSCRIBE_PATH}`;
    expect(message.headers['List-Unsubscribe']).toBe(`<${unsubscribeUrl}>`);
    expect(message.text).toContain(fr.mail.footer.unsubscribe);
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    const message = composer().compose(
      monitorAlertMailFor('admin@example.test', [
        {
          kind: 'UNPARSEABLE_ANNEXE',
          detail: 'text JORFTEXT000000000401: parse error',
        },
      ]),
    );

    expect(message.subject.trim().length).toBeGreaterThan(10);
  });

  it('carries every alert of a run in one message, grouped by kind', () => {
    const message = composer().compose(
      monitorAlertMailFor('admin@example.test', [
        { kind: 'UNMATCHED_COMMUNE', detail: 'NOR A: Sainte-Foy not matched' },
        { kind: 'OUTCOME_CHANGED', detail: 'NOR A: Nîmes RECONNU → REFUSE' },
        { kind: 'UNMATCHED_COMMUNE', detail: 'NOR A: Beaulieu not matched' },
      ]),
    );

    for (const commune of ['Sainte-Foy', 'Beaulieu', 'Nîmes']) {
      expect(message.text).toContain(commune);
    }
    // Each kind is named once, above the alerts it covers, however many of
    // them the run produced.
    expect(
      message.text.split(fr.mail.jorf.alert.kindLabel.UNMATCHED_COMMUNE),
    ).toHaveLength(2);
  });

  it('counts the alerts it does not spell out instead of listing them all', () => {
    const overflow = 3;
    const message = composer().compose(
      monitorAlertMailFor(
        'admin@example.test',
        Array.from({ length: MAX_ALERTS_DETAILED + overflow }, (_, index) => ({
          kind: 'UNMATCHED_COMMUNE' as const,
          detail: `NOR A: commune ${index} not matched`,
        })),
      ),
    );

    // An arrêté whose communes the referential resolves none of would put ~720
    // lines in one message; the table holds them all, the message points at it.
    expect(message.text).toContain(`commune ${MAX_ALERTS_DETAILED - 1} `);
    expect(message.text).not.toContain(`commune ${MAX_ALERTS_DETAILED} `);
    expect(message.text).toContain(fr.mail.jorf.alert.more(String(overflow)));
  });
});
