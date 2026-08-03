import type { MailMessage } from 'src/mail/mail-message';

/**
 * Injection token of the transport that carries the assembled message out.
 *
 * The transport is a dependency behind a token rather than a branch on the
 * environment inside MailService: the tests of both phases put their own
 * transport behind it through DI, without touching process.env, and choosing
 * one by configuration stays in a single useFactory (docs/plan/emails.md).
 */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * What a transport owes the service: it either hands the message over or
 * throws. A resolved promise means the message was accepted — there is no
 * boolean to check, so a message cannot disappear quietly.
 *
 * The failure it throws is a MailDeliveryError naming a status and a reason:
 * that message and its stack reach the logs, and neither the recipient address
 * nor the body of the email may be in them (docs/research/emails.md).
 */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}
