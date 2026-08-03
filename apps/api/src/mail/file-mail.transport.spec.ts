import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import {
  FileMailTransport,
  type MailOutbox,
} from 'src/mail/file-mail.transport';
import { MailComposer } from 'src/mail/mail-composer';
import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { ComposeMailInput, MailMessage } from 'src/mail/mail-message';

const RECIPIENT = 'destinataire@example.test';
const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';
const OUTBOX_DIR = '/tmp/outbox-de-test';
const SUBJECT = 'Votre commune est concernée par un arrêté';

const VALUES: Record<string, string> = { FRONTEND_URL, MAIL_FROM };
const configStub = {
  get: (key: string): string | undefined => VALUES[key],
} as unknown as ConfigService;

const message = (overrides: Partial<ComposeMailInput> = {}): MailMessage =>
  new MailComposer(configStub).compose({
    to: RECIPIENT,
    subject: SUBJECT,
    reason: 'vous suivez la commune de Nîmes',
    unsubscribePath: '/desabonnement/jeton-123',
    blocks: [
      { kind: 'paragraph', text: 'Un texte de test suffisamment long.' },
      { kind: 'link', text: 'Voir votre sinistre', path: '/sinistres/abc' },
    ],
    ...overrides,
  });

/**
 * The channel of the local transport, as the test reads it: the same interface
 * the developer's file system implements, with the files kept in memory. No
 * disk is touched here, and nothing else is stubbed — what the developer opens
 * in a browser is what this test asserts on.
 */
class OutboxSpy implements MailOutbox {
  readonly created: string[] = [];
  readonly files = new Map<string, string>();
  failure: Error | undefined;

  mkdir(dir: string): Promise<void> {
    this.created.push(dir);
    return Promise.resolve();
  }

  writeFile(file: string, contents: string): Promise<void> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    this.files.set(file, contents);
    return Promise.resolve();
  }
}

/** A clock that stands still, so that a file name is an assertable value. */
const FROZEN = new Date('2026-08-03T10:15:30.123Z');
const frozenClock = (): Date => FROZEN;

const transportWith = (outbox: MailOutbox): FileMailTransport =>
  new FileMailTransport(OUTBOX_DIR, outbox, frozenClock);

/**
 * The set of addresses a file names — a set, because the .txt file carries the
 * unsubscribe address twice on purpose: once as a header, once in the footer.
 */
const linksOf = (contents: string): string[] =>
  [
    ...new Set(
      [...contents.matchAll(/https?:\/\/[^\s"<>]+/g)].map(([url]) => url),
    ),
  ].sort();

const fileNamed = (outbox: OutboxSpy, extension: string): [string, string] => {
  const found = [...outbox.files].filter(([path]) => path.endsWith(extension));
  expect(found).toHaveLength(1);
  return found[0] as [string, string];
};

const LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
let written: string[];

beforeEach(() => {
  written = [];
  for (const level of LEVELS) {
    jest
      .spyOn(Logger.prototype, level)
      .mockImplementation((...args: unknown[]) => {
        written.push(JSON.stringify(args));
      });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('FileMailTransport', () => {
  it('writes the message to its channel without reaching the network', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const outbox = new OutboxSpy();

    await transportWith(outbox).send(message());

    // The whole point of the local transport: in development nothing leaves
    // the machine, and no address of a real person is contacted.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outbox.files.size).toBe(2);
  });

  it('creates the outbox directory before writing into it', async () => {
    const outbox = new OutboxSpy();

    await transportWith(outbox).send(message());

    expect(outbox.created).toEqual([OUTBOX_DIR]);
  });

  it('puts the headers and the text version into the .txt file', async () => {
    const outbox = new OutboxSpy();
    const sent = message();

    await transportWith(outbox).send(sent);

    const [, contents] = fileNamed(outbox, '.txt');
    // Headers first, body after: the developer has the envelope and the
    // message in a single file (docs/research/emails.md).
    expect(contents).toContain(`From: Mon Sinistre <${MAIL_FROM}>`);
    expect(contents).toContain(`To: ${RECIPIENT}`);
    expect(contents).toContain(`Subject: ${SUBJECT}`);
    expect(contents).toContain(
      `List-Unsubscribe: <${FRONTEND_URL}/desabonnement/jeton-123>`,
    );
    expect(contents).toContain(
      'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    );
    expect(contents).toContain(sent.text);
  });

  it('puts the HTML version into the .html file, so that the links can be clicked', async () => {
    const outbox = new OutboxSpy();
    const sent = message();

    await transportWith(outbox).send(sent);

    const [, contents] = fileNamed(outbox, '.html');
    expect(contents).toBe(sent.html);
    // The two files show the same addresses — the developer checking the
    // clickable version is checking the one that will be sent.
    const [, text] = fileNamed(outbox, '.txt');
    expect(linksOf(contents)).toEqual(linksOf(text));
    expect(linksOf(contents)).toContain(`${FRONTEND_URL}/sinistres/abc`);
  });

  it('names both files after the time and the subject, in the outbox directory', async () => {
    const outbox = new OutboxSpy();

    await transportWith(outbox).send(message());

    const [txtPath] = fileNamed(outbox, '.txt');
    const [htmlPath] = fileNamed(outbox, '.html');
    // Diacritics and spaces of a French subject become a plain name a shell
    // and a browser can handle; the pair shares it, so the two versions of one
    // message sit next to each other.
    expect(txtPath).toBe(
      `${OUTBOX_DIR}/2026-08-03T10-15-30-123Z-001-votre-commune-est-concernee-par-un-arrete.txt`,
    );
    expect(htmlPath).toBe(txtPath.replace(/\.txt$/, '.html'));
  });

  it('keeps a long or unwritable subject from making an unusable name', async () => {
    const outbox = new OutboxSpy();

    await transportWith(outbox).send(
      message({ subject: `Arrêté du ${'très long '.repeat(20)}mois` }),
    );

    const [txtPath] = fileNamed(outbox, '.txt');
    const name = txtPath.slice(OUTBOX_DIR.length + 1);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toMatch(/^[a-z0-9.-]+$/i);
  });

  it('still names the pair when the subject leaves nothing to name it with', async () => {
    const outbox = new OutboxSpy();

    // A subject the composer accepts (one non-empty line) but that has no
    // letter of its own: without a fallback the pair would be named after the
    // timestamp alone, and the developer would look for it by subject.
    await transportWith(outbox).send(message({ subject: '!!! ??? —' }));

    const [txtPath] = fileNamed(outbox, '.txt');
    expect(txtPath).toBe(
      `${OUTBOX_DIR}/2026-08-03T10-15-30-123Z-001-message.txt`,
    );
  });

  it('keeps a subject from leading the file out of the outbox', async () => {
    const outbox = new OutboxSpy();

    await transportWith(outbox).send(
      message({ subject: '../../etc/passwd est un fichier' }),
    );

    // The subject is data from a feature, and one day from a commune name:
    // nothing of it may act as a path.
    const [txtPath] = fileNamed(outbox, '.txt');
    expect(txtPath.startsWith(`${OUTBOX_DIR}/`)).toBe(true);
    expect(txtPath).not.toContain('..');
    expect(txtPath.slice(OUTBOX_DIR.length + 1)).not.toContain('/');
  });

  it('gives two messages of the same subject two names', async () => {
    const outbox = new OutboxSpy();
    const transport = transportWith(outbox);

    await transport.send(message());
    await transport.send(message());

    // The clock stands still here on purpose: two sends of one mailing can
    // land in the same millisecond, and a message overwritten in the outbox
    // reads exactly like a message that was never sent.
    expect(outbox.files.size).toBe(4);
  });

  it('reports a failed write to the caller as a delivery failure', async () => {
    const outbox = new OutboxSpy();
    outbox.failure = new Error(`EACCES: ${OUTBOX_DIR} is not writable`);

    await expect(transportWith(outbox).send(message())).rejects.toThrow(
      MailDeliveryError,
    );
  });

  it('keeps the recipient address and the body out of the failure it throws', async () => {
    const outbox = new OutboxSpy();
    outbox.failure = new Error('EACCES: permission denied');
    const sent = message();

    const thrown: unknown = await transportWith(outbox)
      .send(sent)
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(thrown).toBeInstanceOf(MailDeliveryError);

    // The text of a transport failure reaches the logs, and the rule of the
    // project holds there too (apps/api/CLAUDE.md, "Правила проекта").
    const failure = thrown as Error;
    const reported = `${failure.message}\n${failure.stack ?? ''}\n${String(
      failure.cause,
    )}`;
    expect(reported).toContain('EACCES');
    expect(reported).not.toContain(RECIPIENT);
    expect(reported).not.toContain('destinataire');
    expect(reported).not.toContain(sent.text);
  });

  it('logs the subject and the file, never the recipient', async () => {
    const outbox = new OutboxSpy();

    await transportWith(outbox).send(message());

    const logged = written.join('\n');
    // A developer must be able to find the file from the log; the address is
    // the one thing that may not be in it — this is the log of the running
    // application, the same one phase 2 will read.
    expect(logged).toContain(SUBJECT);
    expect(logged).toContain('votre-commune-est-concernee');
    expect(logged).not.toContain(RECIPIENT);
    expect(logged).not.toContain('destinataire');
  });
});
