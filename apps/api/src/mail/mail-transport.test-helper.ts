import type { MailMessage } from './mail-message';
import type { MailTransport } from './mail-transport';

/**
 * The plain case every spec that overrides `MAIL_TRANSPORT` needs: accept and
 * record. Specs that also need a one-shot delivery failure keep their own
 * class for that (e.g. `veille.int-spec.ts`'s `RecordingTransport`), rather
 * than growing this one a flag it mostly won't use.
 */
export class RecordingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}
