/**
 * Assembled but not delivered. Own error class rather than HttpException: the
 * mail module does not know what its failure means for the HTTP answer. Its
 * message reaches the logs, so it names a status and a reason and never carries
 * the recipient address or the body.
 */
export class MailDeliveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MailDeliveryError';
  }
}
