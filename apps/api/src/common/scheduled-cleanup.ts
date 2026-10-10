import type { Logger } from '@nestjs/common';
import { errorSummary, stackOf } from './error-report';

/**
 * Runs one step of a scheduled tick isolated from its siblings — a cleanup
 * sharing a `@Cron` handler with others, a mark or count of the outbox drain
 * (`src/jorf/mail/drain-outbox.ts`): nothing above a scheduled tick catches
 * anything (`AllExceptionsFilter` only sees requests), so an unguarded
 * rejection would cost the remaining steps their turn and reach the log as
 * the scheduler's own unhandled-rejection trace, message and all. One copy
 * for every such place — a second one is not warranted.
 */
export async function runGuarded(
  logger: Logger,
  name: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    logger.error(`${name} failed: ${errorSummary(error)}`, stackOf(error));
  }
}
