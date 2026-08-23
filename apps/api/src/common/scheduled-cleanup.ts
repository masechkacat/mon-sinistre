import type { Logger } from '@nestjs/common';
import { errorSummary, stackOf } from './error-report';

/**
 * Runs one cleanup of a scheduled tick isolated from the others it shares a
 * `@Cron` handler with: nothing above a scheduled tick catches anything
 * (`AllExceptionsFilter` only sees requests), so an unguarded rejection would
 * cost the remaining cleanups their turn and reach the log as the
 * scheduler's own unhandled-rejection trace, message and all. Shared by every
 * handler that runs more than one independent `deleteMany` per tick (veille,
 * account) — second copy not warranted.
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
