import { Inject, Injectable, Logger } from '@nestjs/common';

import { MailComposer } from 'src/mail/compose/mail-composer';
import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { ComposeMailInput, MailMessage } from 'src/mail/mail-message';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';

/**
 * The single point through which every email of the product leaves. It knows
 * nothing about the environment — the transport arrives through the
 * MAIL_TRANSPORT token. Who owns which rate limit — `CLAUDE.md` of this
 * module.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly composer: MailComposer,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  /**
   * Returns once the transport has accepted the message, throws otherwise:
   * MailCompositionError or MailDeliveryError. There is no result to inspect
   * and no path on which a message vanishes without a word.
   */
  async send(input: ComposeMailInput): Promise<void> {
    const message = this.compose(input);

    try {
      await this.transport.send(message);
    } catch (cause) {
      const failure = deliveryErrorOf(cause);
      this.logger.error(
        `Email not sent: "${message.subject}"`,
        withoutAddress(reportOf(failure), message.to),
      );
      throw failure;
    }

    // The subject and nothing else.
    this.logger.log(`Email sent: "${message.subject}"`);
  }

  private compose(input: ComposeMailInput): MailMessage {
    try {
      return this.composer.compose(input);
    } catch (cause) {
      // Not even the subject: composition may well have failed on the subject
      // itself, and the error already names the offending field.
      this.logger.error(
        'An email could not be composed and was not sent',
        withoutAddress(reportOf(cause), input.to),
      );
      throw cause;
    }
  }
}

/** Anything a transport throws is wrapped, so a failed delivery is a
 * MailDeliveryError every time. The original stays as the cause. */
const deliveryErrorOf = (cause: unknown): MailDeliveryError =>
  cause instanceof MailDeliveryError
    ? cause
    : new MailDeliveryError('the transport failed', { cause });

/** A guard against a cycle in the chain of causes. */
const MAX_CAUSE_DEPTH = 5;

/**
 * The stack, then the chain of causes, because a stack does not carry it —
 * without the chain a log would say "request failed" and never whether it was a
 * timeout, a refused connection or a bad answer. Names and messages only.
 */
const reportOf = (thrown: unknown): string => {
  if (!(thrown instanceof Error)) {
    return 'a value that is not an Error was thrown';
  }

  const lines = [thrown.stack ?? `${thrown.name}: ${thrown.message}`];
  let cause: unknown = thrown.cause;
  while (cause instanceof Error && lines.length <= MAX_CAUSE_DEPTH) {
    lines.push(`caused by ${cause.name}: ${cause.message}`);
    cause = cause.cause;
  }
  return lines.join('\n');
};

const ADDRESS_REMOVED = '[address removed]';

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[\\^$.*+?()[\]{}|]/g, String.raw`\$&`);

/**
 * The last gate before an address could reach a log: transports owe an error
 * free of it, but the guarantee must not rest on every future transport getting
 * that right. Case-insensitive — the domain of an address is case-insensitive
 * by RFC 5321, so a provider may answer about "Destinataire@Example.test".
 */
const withoutAddress = (report: string, recipient: string): string =>
  recipient === ''
    ? report
    : report.replace(
        new RegExp(escapeRegExp(recipient), 'gi'),
        ADDRESS_REMOVED,
      );
