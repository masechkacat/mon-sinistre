import { Inject, Injectable, Logger } from '@nestjs/common';

import { MailComposer } from 'src/mail/mail-composer';
import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { ComposeMailInput, MailMessage } from 'src/mail/mail-message';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';

/**
 * The single point through which every email of the product leaves: features
 * describe a message, MailService composes it and hands it to the transport.
 *
 * It knows nothing about the environment — the transport arrives through the
 * MAIL_TRANSPORT token — and it is also the place where a limit such as "no
 * more than one email a day" will go once a feature owns that requirement
 * (docs/plan/emails.md, "Вне скоупа").
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
   * MailCompositionError if the message could not be assembled,
   * MailDeliveryError if it could not be delivered — a failure of a transport
   * always reaches the caller as that type, whatever the transport threw.
   * There is no result to inspect and no path on which a message vanishes
   * without a word.
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

    // The subject and nothing else — the recipient address stays out of the
    // logs on both paths (apps/api/CLAUDE.md, "Правила проекта").
    this.logger.log(`Email sent: "${message.subject}"`);
  }

  private compose(input: ComposeMailInput): MailMessage {
    try {
      return this.composer.compose(input);
    } catch (cause) {
      // Not even the subject here: composition may well have failed on the
      // subject itself, and the error already names the offending field.
      this.logger.error(
        'An email could not be composed and was not sent',
        withoutAddress(reportOf(cause), input.to),
      );
      throw cause;
    }
  }
}

/**
 * A transport either honours the contract of MailTransport or it does not, and
 * the calling feature must not have to know which: anything else it throws is
 * wrapped, so that a failed delivery is a MailDeliveryError every time — the
 * promise features are given (apps/api/CLAUDE.md). The original stays as the
 * cause and is reported below.
 */
const deliveryErrorOf = (cause: unknown): MailDeliveryError =>
  cause instanceof MailDeliveryError
    ? cause
    : new MailDeliveryError('the transport failed', { cause });

/** How deep the chain of causes is followed — a guard against a cycle. */
const MAX_CAUSE_DEPTH = 5;

/**
 * What reaches the logs of a failure: the stack, and then the chain of causes,
 * because a stack does not carry it. Without the chain the log of phase 2 would
 * read "Scaleway TEM request failed" and never say whether it was a timeout, a
 * refused connection or a bad answer (docs/research/emails.md).
 *
 * Names and messages only, never the values an error may carry.
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

/** Every character a regular expression would otherwise read as syntax. */
const escapeRegExp = (value: string): string =>
  value.replaceAll(/[\\^$.*+?()[\]{}|]/g, String.raw`\$&`);

/**
 * The last gate before an address could reach a log. Transports and the
 * composer owe an error free of it, but the guarantee features rely on must not
 * rest on every future transport getting that right: this service is the only
 * place able to enforce it, and it knows the address it just handed over.
 *
 * Case-insensitive: the domain of an address is case-insensitive by RFC 5321,
 * so a provider is free to answer about "Destinataire@Example.test" whatever
 * was sent to it, and an exact match would hand that straight to the logs.
 */
const withoutAddress = (report: string, recipient: string): string =>
  recipient === ''
    ? report
    : report.replace(
        new RegExp(escapeRegExp(recipient), 'gi'),
        ADDRESS_REMOVED,
      );
