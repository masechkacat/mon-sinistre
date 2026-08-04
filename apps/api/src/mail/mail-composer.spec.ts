import { fr } from 'src/i18n/fr';
import { mailLinksOf } from 'src/mail/mail-links.test-helper';
import { MailCompositionError } from 'src/mail/mail-composition.error';
import {
  MailComposer,
  type MailComposerOptions,
} from 'src/mail/mail-composer';
import type { ComposeMailInput } from 'src/mail/mail-message';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

// The two values, handed over directly: the composer takes no configuration
// service, so the test neither builds one nor depends on whatever FRONTEND_URL
// the developer has exported. A value left empty is how a case says "not set".
const composerWith = (options: MailComposerOptions) =>
  new MailComposer(options);

const composer = () =>
  composerWith({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM });

// Subject and both bodies must stay above 10 characters — shorter ones are
// rejected by the provider of phase 2 (docs/research/emails.md).
const input = (
  overrides: Partial<ComposeMailInput> = {},
): ComposeMailInput => ({
  to: 'destinataire@example.test',
  subject: 'Votre commune est concernée',
  reason: 'vous suivez la commune de Nîmes',
  unsubscribePath: '/desabonnement/jeton-123',
  blocks: [
    { kind: 'paragraph', text: 'Un texte de test suffisamment long.' },
    { kind: 'link', text: 'Voir votre plan d’action', path: '/sinistres/42' },
    // A query string is the case where the two versions could still drift: the
    // HTML one has to escape the ampersand, the text one must not.
    {
      kind: 'link',
      text: 'Consulter la liste des communes',
      path: '/communes?risque=inondation&page=2',
    },
    { kind: 'list', items: ['Premier point', 'Second point'] },
  ],
  ...overrides,
});

describe('MailComposer', () => {
  it('carries a subject, both sender parts and two non-empty bodies', () => {
    const message = composer().compose(input());

    expect(message.subject).toBe('Votre commune est concernée');
    expect(message.from).toEqual({
      name: fr.mail.senderName,
      email: MAIL_FROM,
    });
    expect(message.to).toBe('destinataire@example.test');
    expect(message.text.trim().length).toBeGreaterThan(10);
    expect(message.html.trim().length).toBeGreaterThan(10);
  });

  it('renders the same set of links in both versions', () => {
    const message = composer().compose(input());

    // Held by construction, not by discipline: a link is described once as a
    // block and both renderers must emit it (docs/research/emails.md).
    expect(mailLinksOf(message.text)).toEqual(mailLinksOf(message.html));
    expect(mailLinksOf(message.text).size).toBeGreaterThan(0);
  });

  it('keeps the text version free of markup', () => {
    const message = composer().compose(input());

    expect(message.text).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(message.text).not.toMatch(/&[a-z]+;|&#\d+;/i);
  });

  it('leaves text that HTML would escape as the reader wrote it', () => {
    const message = composer().compose(
      input({
        // Characters the HTML renderer has to escape must not reach the text
        // version escaped: it is read as is in a plain-text client.
        blocks: [
          { kind: 'paragraph', text: 'Dégâts « eau & boue » chez vous' },
        ],
      }),
    );

    expect(message.text).toContain('Dégâts « eau & boue » chez vous');
    expect(message.text).not.toMatch(/&[a-z]+;|&#\d+;/i);
  });

  it('spells links out as absolute URLs built from FRONTEND_URL', () => {
    const message = composer().compose(input());

    expect(message.text).toContain(`${FRONTEND_URL}/sinistres/42`);
    expect(message.text).toContain(`${FRONTEND_URL}/desabonnement/jeton-123`);
    // The link text stays next to its URL: a bare address tells the reader
    // nothing about where it leads.
    expect(message.text).toMatch(
      new RegExp(`Voir votre plan d’action.{0,3}${FRONTEND_URL}/sinistres/42`),
    );
  });

  it('escapes user-supplied text in the HTML version', () => {
    const message = composer().compose(
      input({
        blocks: [
          { kind: 'paragraph', text: 'Eau & boue <chez vous>' },
          // List items come from the same outside data — commune names, what
          // the reader typed — and are rendered by their own branch.
          { kind: 'list', items: ['Garage <sous-sol>', 'Cave & couloir'] },
        ],
      }),
    );

    expect(message.html).toContain('<li>Garage &lt;sous-sol&gt;</li>');
    expect(message.html).toContain('<li>Cave &amp; couloir</li>');

    expect(message.html).toContain('Eau &amp; boue &lt;chez vous&gt;');
    expect(message.html).not.toContain('<chez vous>');
  });

  it('declares the language of the HTML version', () => {
    // The product speaks French to a reader who may use a screen reader
    // (WCAG 2.1 AA, a hard constraint of the project).
    expect(composer().compose(input()).html).toContain('<html lang="fr"');
  });

  it('explains in the footer why the message arrived, in French, from the dictionary', () => {
    const message = composer().compose(input());

    const why = fr.mail.footer.why('vous suivez la commune de Nîmes');
    expect(message.text).toContain(why);
    expect(message.html).toContain(why);
    expect(message.text).toContain(fr.mail.footer.signature);
    expect(message.text).toContain(fr.mail.footer.noReply);
  });

  it('puts the unsubscribe link in the footer of every message', () => {
    const message = composer().compose(input({ blocks: [] }));

    const unsubscribeUrl = `${FRONTEND_URL}/desabonnement/jeton-123`;
    expect(message.text).toContain(fr.mail.footer.unsubscribe);
    expect(message.text).toContain(unsubscribeUrl);
    expect(message.html).toContain(`href="${unsubscribeUrl}"`);
    expect(message.html).toContain(fr.mail.footer.unsubscribe);
  });

  it('repeats the unsubscribe link in the List-Unsubscribe headers', () => {
    const message = composer().compose(input());

    // Angle brackets are required by RFC 2369; the POST header (RFC 8058) is
    // what makes the mail client show its own one-click button.
    expect(message.headers['List-Unsubscribe']).toBe(
      `<${FRONTEND_URL}/desabonnement/jeton-123>`,
    );
    expect(message.headers['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
  });

  // Forms the URL parser resolves to another host although they open like an
  // ordinary path: for http(s) a backslash counts as a slash, and tabs and
  // newlines are stripped before parsing.
  const OFF_SITE_PATHS: readonly [string, string][] = [
    ['an empty path', ''],
    ['blank characters', '   '],
    ['a path that is not rooted', 'desabonnement/jeton-123'],
    ['an absolute URL instead of a path', 'https://ailleurs.test/stop'],
    ['a protocol-relative address', '//ailleurs.test/stop'],
    ['a backslash instead of the second slash', '/\\ailleurs.test/stop'],
    ['a tab hiding the second slash', '/\t/ailleurs.test/stop'],
    ['a newline hiding the second slash', '/\n/ailleurs.test/stop'],
  ];

  it.each(OFF_SITE_PATHS)(
    'refuses to compose a message whose unsubscribe link is %s',
    (_case, unsubscribePath) => {
      // The type already forbids omitting the link; this is the runtime half of
      // the same rule, for values that arrive from configuration or from JSON.
      // The link also travels in List-Unsubscribe, which mail clients POST to.
      const attempt = () => composer().compose(input({ unsubscribePath }));

      expect(attempt).toThrow(MailCompositionError);
      expect(attempt).toThrow(/unsubscribe/i);
    },
  );

  it.each(OFF_SITE_PATHS)(
    'refuses to compose a message whose body link is %s',
    (_case, path) => {
      // Body links go through the same gate: a feature could just as well be
      // handed a path from data it did not write.
      const attempt = () =>
        composer().compose(
          input({ blocks: [{ kind: 'link', text: 'Voir le plan', path }] }),
        );

      expect(attempt).toThrow(MailCompositionError);
      expect(attempt).toThrow(/link path/i);
    },
  );

  it.each([
    ['is empty', '   '],
    ['holds a line break', 'Votre commune\nBcc: quelquun@example.test'],
  ])('refuses to compose a message whose subject %s', (_case, subject) => {
    // The subject is carried as a header, and the local transport of this
    // phase writes it into a file as one: a break would forge a header.
    const attempt = () => composer().compose(input({ subject }));

    expect(attempt).toThrow(MailCompositionError);
    expect(attempt).toThrow(/subject/i);
  });

  it.each([
    ['is empty', '   '],
    [
      'holds a line break',
      'destinataire@example.test\nBcc: quelquun@example.test',
    ],
    ['holds a second address', 'destinataire@example.test, autre@example.test'],
    // Forms an address grammar allows and this skeleton does not: a caller has
    // no reason to decorate the one address a message carries, and the angle
    // brackets would go into the header verbatim.
    ['carries a display name', 'Nom Prénom <destinataire@example.test>'],
    ['is not an address at all', 'destinataire'],
  ])('refuses to compose a message whose recipient %s', (_case, to) => {
    // The address becomes a header line, and one message carries one address:
    // two subscribers must never see each other.
    const attempt = () => composer().compose(input({ to }));

    expect(attempt).toThrow(MailCompositionError);
    expect(attempt).toThrow(/recipient/i);
  });

  it('refuses to compose a message when the link cannot be made absolute', () => {
    const attempt = () =>
      composerWith({ baseUrl: '', senderEmail: MAIL_FROM }).compose(input());

    // Without the base the link would read "undefined/desabonnement/…" and the
    // "the link is there" assertions above would happily pass.
    expect(attempt).toThrow(MailCompositionError);
    expect(attempt).toThrow(/FRONTEND_URL/);
  });

  it.each([
    ['is missing', ''],
    ['is not an address', 'no-reply'],
    // Bootstrap validation would have caught these; the composer checks all
    // the same, because it is the one writing the "From:" header.
    ['carries a display name', 'Mon Sinistre <no-reply@example.test>'],
    ['holds a line break', 'no-reply@example.test\nBcc: quelquun@example.test'],
  ])(
    'refuses to compose a message when the sender address %s',
    (_case, value) => {
      const attempt = () =>
        composerWith({
          baseUrl: FRONTEND_URL,
          senderEmail: value,
        }).compose(input());

      expect(attempt).toThrow(MailCompositionError);
      expect(attempt).toThrow(/MAIL_FROM/);
    },
  );

  it('never leaks the recipient address into the error of a failed composition', () => {
    // The message of an exception travels to the logs; the address must not.
    try {
      composer().compose(input({ unsubscribePath: '' }));
      throw new Error('compose() was expected to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain(
        'destinataire@example.test',
      );
    }
  });
});
