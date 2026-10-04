import type { ThrottlerStorageService } from '@nestjs/throttler';

/**
 * `storage.clear()` alone is not a reset since @nestjs/throttler 6.7: the next
 * increment rebuilds the counter from the private `hitExpirations`.
 */
export function resetThrottler(throttler: ThrottlerStorageService): void {
  throttler.storage.clear();
  (
    throttler as unknown as { hitExpirations: Map<string, unknown> }
  ).hitExpirations.clear();
}
