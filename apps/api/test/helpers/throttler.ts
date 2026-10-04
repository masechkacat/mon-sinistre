import type { INestApplication, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

/**
 * The stock storage behind a reset it does not have: since @nestjs/throttler
 * 6.7 `storage.clear()` is not one (the next increment rebuilds the counter
 * from a private map), so a reset swaps in a fresh instance instead.
 * `createIntTestApp` installs it under `ThrottlerStorage`.
 */
export class ResettableThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private current = new ThrottlerStorageService();

  increment(...args: Parameters<ThrottlerStorage['increment']>) {
    return this.current.increment(...args);
  }

  reset(): void {
    this.current.onApplicationShutdown();
    this.current = new ThrottlerStorageService();
  }

  onApplicationShutdown(): void {
    this.current.onApplicationShutdown();
  }
}

export function resetThrottler(app: INestApplication): void {
  app.get<ResettableThrottlerStorage>(ThrottlerStorage).reset();
}
