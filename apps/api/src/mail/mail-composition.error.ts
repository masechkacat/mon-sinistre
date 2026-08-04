/**
 * Could not be assembled; thrown before anything reaches a transport, so a
 * half-built email never leaves. Its message reaches the logs, so it names the
 * offending field and never its value: paths hold unsubscribe tokens.
 */
export class MailCompositionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MailCompositionError';
  }
}
