import { MailDeliveryError } from './mail-delivery.error';
import type { MailMessage } from './mail-message';
import type { MailTransport } from './mail-transport';

/**
 * The plain case every spec that overrides `MAIL_TRANSPORT` needs: accept and
 * record, plus a one-shot delivery failure via `failNext` for specs that
 * assert on a failed send. `veille.int-spec.ts` predates this flag and keeps
 * its own identical class; a third spec needing the same behaviour should
 * import this one rather than add a third copy.
 */
export class RecordingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  /** Consumed by the next `send()` only — a one-shot failure for a single test. */
  failNext = false;

  send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new MailDeliveryError('boom'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}
