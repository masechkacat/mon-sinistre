import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { MailMessage } from 'src/mail/mail-message';
import type { MailTransport } from 'src/mail/mail-transport';

/**
 * Where the local transport puts a message. The file system is behind an
 * interface handed to the constructor — the same shape as the fetch function of
 * GeoApiClient — so the test reads the very channel the developer opens, with
 * no disk and no mock of node:fs in the way.
 */
export interface MailOutbox {
  mkdir(dir: string): Promise<void>;
  writeFile(file: string, contents: string): Promise<void>;
}

const nodeOutbox: MailOutbox = {
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  writeFile: (file, contents) => writeFile(file, contents, 'utf8'),
};

/**
 * Relative to the working directory of the API, which npm sets to apps/api —
 * the directory is in the root .gitignore, because real addresses end up in
 * those files.
 *
 * The only spelling of the name in code, and it stays in this module because
 * this module is what the name is a fact about. Applying it is not done here,
 * though: the schema of the environment declares it as the default of
 * MAIL_OUTBOX_DIR, so a transport is always handed a directory and there is one
 * place to read what happens when .env says nothing. A second default in the
 * constructor below would be dead in production and alive only in tests — the
 * kind that stops matching what runs.
 */
export const DEFAULT_MAIL_OUTBOX_DIR = '.mail-outbox';

/** Long enough to recognise a French subject, short enough for any file system. */
const MAX_SLUG_LENGTH = 60;

/**
 * The transport of local development: a message is written as a pair of files
 * instead of being sent. Nothing leaves the machine — no address of a real
 * person can be reached from a development database — and the developer reads
 * the .txt as the recipient of a plain-text client would, then opens the .html
 * in a browser and clicks the links.
 *
 * Mailpit and friends were turned down for it: they need a container Ralph Loop
 * cannot start, while this needs neither a dependency nor a service
 * (docs/research/emails.md).
 */
export class FileMailTransport implements MailTransport {
  private readonly logger = new Logger(FileMailTransport.name);

  /**
   * Two messages of one mailing can be written in the same millisecond, and a
   * message overwritten in the outbox looks exactly like a message that was
   * never sent — the failure the whole mail module exists to make impossible.
   * Why the name departs from research this way — docs/decisions.md, 03.08.2026.
   */
  private written = 0;

  constructor(
    private readonly dir: string,
    private readonly outbox: MailOutbox = nodeOutbox,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async send(message: MailMessage): Promise<void> {
    const name = this.nextFileName(message.subject);

    try {
      await this.outbox.mkdir(this.dir);
      // The .txt goes last on purpose: a write can fail halfway (no space, no
      // permission), and the file the developer looks for first is then the
      // one that only exists when the pair is complete.
      await this.outbox.writeFile(join(this.dir, `${name}.html`), message.html);
      await this.outbox.writeFile(
        join(this.dir, `${name}.txt`),
        textFile(message),
      );
    } catch (cause) {
      // The cause carries the errno and the path, both of which the developer
      // needs; the address and the body stay out of it, as of any transport
      // failure (apps/api/CLAUDE.md, "Правила проекта").
      throw new MailDeliveryError('the local outbox could not be written', {
        cause,
      });
    }

    // The subject and the name of the file — enough to find the message on
    // disk, and never the recipient.
    this.logger.log(
      `Email written to the local outbox: "${message.subject}" (${name})`,
    );
  }

  private nextFileName(subject: string): string {
    this.written += 1;
    const stamp = this.now()
      .toISOString()
      .replaceAll(':', '-')
      .replace('.', '-');
    const sequence = String(this.written).padStart(3, '0');
    return `${stamp}-${sequence}-${slugify(subject)}`;
  }
}

/**
 * Headers first, then the text version — the envelope and the message in one
 * file. What a provider will put into the headers of the sent email is what a
 * developer reads here, including the address that stops the messages.
 */
const textFile = (message: MailMessage): string => {
  const headers = [
    `From: ${message.from.name} <${message.from.email}>`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    ...Object.entries(message.headers).map(
      ([key, value]) => `${key}: ${value}`,
    ),
  ];
  return `${headers.join('\n')}\n\n${message.text}`;
};

/**
 * A French subject has spaces, diacritics and punctuation; a file name that a
 * shell and a browser handle without quoting has none of them.
 */
const slugify = (subject: string): string => {
  const slug = subject
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replaceAll(/^-+|-+$/g, '');

  // A subject made of nothing but punctuation would leave no name at all, and
  // the pair of files still has to be found.
  return slug === '' ? 'message' : slug;
};
