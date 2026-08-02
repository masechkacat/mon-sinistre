import { ValidationPipe } from '@nestjs/common';

/**
 * The global validation pipe, shared between main.ts and the integration
 * tests so they can never drift apart: whitelist strips properties absent
 * from the DTO; forbidNonWhitelisted rejects them outright so unexpected
 * input fails loudly rather than silently.
 */
export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}
