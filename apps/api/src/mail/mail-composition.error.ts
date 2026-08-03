/**
 * A message could not be assembled — a missing base address, a link that is
 * not a path of the site. Thrown before anything is handed to a transport, so
 * a half-built email never leaves.
 *
 * Own error class rather than HttpException: the mail skeleton does not know
 * what its failure means for the HTTP answer, and the calling feature decides.
 * The message of this error reaches the logs, so it names the offending field
 * and never carries its value: paths hold unsubscribe tokens, and inputs hold
 * addresses.
 */
export class MailCompositionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MailCompositionError';
  }
}
