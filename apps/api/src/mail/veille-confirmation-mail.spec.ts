import {
  VEILLE_CONFIRM_TTL_DAYS,
  VEILLE_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { mailLinksOf } from 'src/mail/mail-links.test-helper';
import { MailComposer } from 'src/mail/mail-composer';
import type { ComposeMailInput } from 'src/mail/mail-message';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

const composer = () =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

const CONFIRM_TOKEN = 'confirm-token-123';
const UNSUBSCRIBE_TOKEN = 'unsubscribe-token-456';
const COMMUNES = ['Nîmes (Gard)', 'Alès (Gard)'];

/**
 * The shape src/veille/ will build once it exists (task `POST /veille`):
 * fr.mail.veille supplies the strings, the caller supplies the data (token,
 * chosen communes) that is not UI text.
 */
const confirmationInput = (
  overrides: Partial<ComposeMailInput> = {},
): ComposeMailInput => ({
  to: 'destinataire@example.test',
  subject: fr.mail.veille.confirmation.subject,
  reason: fr.mail.veille.reason,
  unsubscribePath: `${VEILLE_UNSUBSCRIBE_PATH}?token=${UNSUBSCRIBE_TOKEN}`,
  blocks: [
    { kind: 'paragraph', text: fr.mail.veille.confirmation.intro },
    { kind: 'list', items: COMMUNES },
    {
      kind: 'link',
      text: fr.mail.veille.confirmation.confirmLink,
      path: `/veille/confirmation?token=${CONFIRM_TOKEN}`,
    },
    {
      kind: 'paragraph',
      text: fr.mail.veille.confirmation.expiresIn(
        String(VEILLE_CONFIRM_TTL_DAYS),
      ),
    },
  ],
  ...overrides,
});

describe('veille confirmation mail (fr.mail.veille + contracts constants)', () => {
  it('carries the confirmation link with its token', () => {
    const message = composer().compose(confirmationInput());

    const confirmUrl = `${FRONTEND_URL}/veille/confirmation?token=${CONFIRM_TOKEN}`;
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
