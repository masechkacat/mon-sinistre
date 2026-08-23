import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { MailMessage } from 'src/mail/mail-message';
import type { MailTransport } from 'src/mail/mail-transport';

/** Behind an interface so the test reads the channel the developer opens, with
 * no disk and no mock of node:fs in the way. */
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
 * The only spelling of the name in code. Applying it happens in the environment
 * schema, which declares it as the default of MAIL_OUTBOX_DIR — a second default
 * in the constructor below would be dead in production and alive only in tests.
 */
export const DEFAULT_MAIL_OUTBOX_DIR = '.mail-outbox';

const MAX_SLUG_LENGTH = 60;

/**
 * Local development: a message is written as a pair of files instead of being
 * sent. Mailpit and friends were turned down because they need a container Ralph
 * Loop cannot start.
 */
export class FileMailTransport implements MailTransport {
  private readonly logger = new Logger(FileMailTransport.name);

  /**
   * Two messages of one mailing can be written in the same millisecond, and a
   * message overwritten in the outbox looks exactly like one never sent.
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
      // The .txt goes last on purpose: a write can fail halfway, and the file
      // the developer looks for first then exists only when the pair is complete.
      await this.outbox.writeFile(join(this.dir, `${name}.html`), message.html);
      await this.outbox.writeFile(
        join(this.dir, `${name}.txt`),
        textFile(message),
      );
    } catch (cause) {
      throw new MailDeliveryError('the local outbox could not be written', {
        cause,
      });
    }

    // Subject and file name only — never the recipient.
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

const slugify = (subject: string): string => {
  const slug = subject
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replaceAll(/^-+|-+$/g, '');

  // A subject of nothing but punctuation would leave no name at all.
  return slug === '' ? 'message' : slug;
};
