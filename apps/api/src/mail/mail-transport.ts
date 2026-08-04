import type { MailMessage } from 'src/mail/mail-message';

/** Behind a token rather than a branch on the environment: tests put their own
 * transport here through DI, without touching process.env. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * A transport either hands the message over or throws — there is no boolean to
 * check, so a message cannot disappear quietly. The failure is a
 * MailDeliveryError whose message reaches the logs, so neither the recipient
 * address nor the body may be in it.
 */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}
