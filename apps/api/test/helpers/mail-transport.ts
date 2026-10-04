import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { MailMessage } from 'src/mail/mail-message';
import type { MailTransport } from 'src/mail/mail-transport';

/**
 * The plain case every spec that overrides `MAIL_TRANSPORT` needs: accept and
 * record, plus a delivery failure for specs that assert on one.
 * `veille.int-spec.ts` predates this flag and keeps its own identical class; a
 * third spec needing the same behaviour should import this one rather than add
 * a third copy.
 */
export class RecordingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  /** Consumed by the next `send()` only — a one-shot failure for a single test. */
  failNext = false;
  /** Refused every time, as opposed to the one-shot above. */
  readonly failFor = new Set<string>();

  send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new MailDeliveryError('boom'));
    }
    if (this.failFor.has(message.to)) {
      return Promise.reject(new MailDeliveryError('boom'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}
