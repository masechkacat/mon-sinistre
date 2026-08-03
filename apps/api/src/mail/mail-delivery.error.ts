/**
 * A message was assembled but could not be delivered: a transport refused it,
 * timed out or answered with an error.
 *
 * Own error class rather than HttpException, for the same reason as
 * MailCompositionError: the mail module does not know what its failure means
 * for the HTTP answer, and the calling feature decides. The two stay distinct
 * because the answer differs — a composition error is a defect of the caller or
 * of the configuration, a delivery error is the outside world.
 *
 * Its message reaches the logs, so it names a status and a reason and never
 * carries the recipient address or the body of the email.
 */
export class MailDeliveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MailDeliveryError';
  }
}
