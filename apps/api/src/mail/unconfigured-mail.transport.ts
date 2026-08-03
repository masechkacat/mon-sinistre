import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { MailTransport } from 'src/mail/mail-transport';

/**
 * Stands where a transport will be until the local one lands — the next task
 * of phase 1 (docs/plan/emails.md) — and refuses every message instead of
 * accepting it.
 *
 * A stand-in that resolved quietly would let a feature believe its email left:
 * exactly the failure the single sending point exists to prevent, and the only
 * one nobody notices. This class goes away with the transport that replaces it.
 */
export class UnconfiguredMailTransport implements MailTransport {
  send(): Promise<void> {
    return Promise.reject(
      new MailDeliveryError('no mail transport is configured'),
    );
  }
}
