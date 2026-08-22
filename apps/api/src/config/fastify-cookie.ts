import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';

/**
 * Registered by both `main.ts` and `createIntTestApp`: the refresh cookie
 * (login, and later refresh/logout) needs `@fastify/cookie` active in every
 * `NestFastifyApplication` the auth endpoints run in, integration tests
 * included — without it `reply.setCookie` does not exist.
 */
export async function registerCookiePlugin(
  app: NestFastifyApplication,
  cookieSecret: string,
): Promise<void> {
  await app.register(fastifyCookie, { secret: cookieSecret });
}
